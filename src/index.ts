#!/usr/bin/env node

/**
 * This MCP server provides a tool to update a README.md file,
 * intended to be used with Git hooks (e.g., post-commit).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises"; // For asynchronous file operations
import path from "path";     // For handling file paths
import axios from "axios";   // For making HTTP requests to Ollama API

// Get Ollama host from environment variable, default to localhost
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const OLLAMA_MODEL = "llama3"; // Model to use for analysis

/**
 * Create an MCP server with capabilities for tools.
 */
const server = new Server(
  {
    name: "readme-updater-mcp",
    version: "0.1.0",
    description: "지정된 README.md 파일에 내용을 추가합니다.", // 서버 설명 (한글)
  },
  {
    capabilities: {
      // resources: {}, // Removed resource capability
      tools: {},
      // prompts: {}, // Removed prompt capability
    },
  }
);

/**
 * Handler that lists available tools.
 * Exposes a single "update_readme" tool.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "update_readme",
        description: "지정된 README.md 파일에 내용을 추가합니다.", // 도구 설명 (한글)
        inputSchema: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "업데이트할 README.md 파일의 절대 경로입니다.", // 파라미터 설명 (한글)
            },
            contentToAppend: {
              type: "string",
              description: "README 파일에 추가할 내용입니다.", // 파라미터 설명 (한글)
            },
            heading: {
              type: "string",
              description: "내용 앞에 추가할 선택적 마크다운 제목입니다 (예: '## 최근 커밋'). 제목이 이미 존재하면 해당 제목 아래에 내용이 추가됩니다.", // 파라미터 설명 (한글)
            },
          },
          required: ["filePath", "contentToAppend"], // 필수 파라미터
        },
      },
    ],
  };
});

/**
 * Handler for the update_readme tool.
 * Reads the README, analyzes potential conflicts with Ollama, and updates the file.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "update_readme") {
    throw new McpError(ErrorCode.MethodNotFound, `알 수 없는 도구입니다: ${request.params.name}`);
  }

  const args = request.params.arguments;

  // Validate arguments
  if (typeof args?.filePath !== 'string' || typeof args?.contentToAppend !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, "Missing required arguments: filePath and contentToAppend must be strings.");
  }
  if (args.heading !== undefined && typeof args.heading !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "Optional argument 'heading' must be a string if provided.");
  }

  const filePath = path.resolve(args.filePath); // 절대 경로 확인
  let contentToAppend = args.contentToAppend; // Use let to modify
  const heading = args.heading;

  // --- Add timestamp ---
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const timestamp = `${year}-${month}-${day}-${hours}:${minutes}`;
  contentToAppend += ` (${timestamp})`; // Append timestamp to the content
  // --- End timestamp ---

  let originalFileContent = ""; // Initialize as empty string

  try {
    try {
      originalFileContent = await fs.readFile(filePath, "utf-8");
    } catch (readError: any) {
      if (readError.code !== 'ENOENT') {
        // For errors other than 'file not found', log a warning but proceed as if the file was empty.
        // This might hide other read errors, but simplifies the logic for this tool's purpose.
        console.warn(`Error reading file ${filePath}, proceeding as empty: ${readError.message}`);
      }
      // If file doesn't exist (ENOENT) or other read error occurred, originalFileContent remains ""
    }

    // 1. Ollama에 분석 요청 (기존 내용 + 새 내용)
    //    - 프롬프트 구성: 충돌 감지 및 병합/수정 제안 요청
    //    - heading이 있으면 해당 섹션 내용을 중심으로 분석 요청
    let relevantExistingContent = originalFileContent; // 기본값: 전체 내용
    let targetSectionExists = false;
    if (heading) {
        const headingIndex = originalFileContent.indexOf(heading);
        if (headingIndex !== -1) {
            targetSectionExists = true;
            const nextHeadingRegex = /^#+\s/gm;
            nextHeadingRegex.lastIndex = headingIndex + heading.length;
            const nextMatch = nextHeadingRegex.exec(originalFileContent);
            const sectionEnd = nextMatch ? nextMatch.index : originalFileContent.length;
            relevantExistingContent = originalFileContent.substring(headingIndex, sectionEnd);
        }
    }

    const prompt = `
      다음은 Markdown 파일의 기존 내용 중 일부입니다:
      \`\`\`markdown
      ${relevantExistingContent}
      \`\`\`

      이제 다음 내용을 추가하려고 합니다:
      \`\`\`markdown
      ${contentToAppend}
      \`\`\`

      두 내용 사이에 의미상 충돌이 있습니까?
      - 충돌이 없다면, 단순히 새 내용을 기존 내용 끝에 추가하면 됩니다.
      - 충돌이 있다면, 어떤 기존 내용을 삭제하거나 수정해야 새 내용과 일관성을 유지할 수 있는지 설명하고, 최종적으로 업데이트될 전체 섹션(또는 파일 전체)의 내용을 제안해주세요.
      - 응답은 최종적으로 파일에 기록될 **수정된 전체 Markdown 내용만** 포함해야 합니다. 다른 설명은 포함하지 마세요. 만약 충돌이 없어 단순히 추가만 하면 된다면, 기존 내용 + 새 내용을 합친 전체 내용을 반환하세요.
    `;

    let finalContent = "";
    try {
      const ollamaResponse = await axios.post(`${OLLAMA_HOST}/api/chat`, {
        model: OLLAMA_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: false, // Get the full response at once
      });

      if (ollamaResponse.data && ollamaResponse.data.message && ollamaResponse.data.message.content) {
        // Ollama 응답에서 최종 Markdown 내용 추출 시도
        finalContent = ollamaResponse.data.message.content.trim();
        // 가끔 모델이 ```markdown 블록으로 감싸서 반환하는 경우 제거
        finalContent = finalContent.replace(/^```markdown\n?/, '').replace(/\n?```$/, '');
      } else {
        throw new Error("Ollama 응답 형식이 올바르지 않습니다.");
      }

    } catch (ollamaError: any) {
      console.error("Ollama API 호출 오류:", ollamaError.message);
      // Ollama 오류 시, 충돌 감지 없이 단순 추가 로직 수행 (Fallback)
      console.warn("Ollama 분석 실패. 충돌 감지 없이 내용을 추가합니다.");

      let insertionPoint = originalFileContent.length;
      let contentToAdd = `\n${contentToAppend}\n`;
      if (heading) {
          const headingIndex = originalFileContent.indexOf(heading);
          if (headingIndex !== -1) {
              const nextHeadingRegex = /^#+\s/gm;
              nextHeadingRegex.lastIndex = headingIndex + heading.length;
              const nextMatch = nextHeadingRegex.exec(originalFileContent);
              insertionPoint = nextMatch ? nextMatch.index : originalFileContent.length;
              const endOfHeadingLine = originalFileContent.indexOf('\n', headingIndex);
              if (endOfHeadingLine !== -1 && endOfHeadingLine < insertionPoint) {
                  insertionPoint = endOfHeadingLine + 1;
              } else {
                   insertionPoint = originalFileContent.length;
              }
          } else {
              contentToAdd = `\n${heading}\n${contentToAppend}\n`;
              insertionPoint = originalFileContent.length;
          }
      }
      finalContent = originalFileContent.slice(0, insertionPoint) + contentToAdd + originalFileContent.slice(insertionPoint);
    }


    // 2. 최종 내용을 파일에 쓰기
    //    - Ollama가 제안한 내용(finalContent)으로 전체 파일을 덮어쓰거나,
    //    - 특정 섹션만 수정해야 하는 경우 해당 섹션만 교체 (여기서는 Ollama가 전체 수정본을 준다고 가정)
    //    - Fallback 시 계산된 finalContent 사용
    if (heading && targetSectionExists) {
        // heading 섹션이 있었고 Ollama가 해당 섹션의 수정본을 주었다고 가정
        // 기존 섹션을 Ollama가 준 finalContent로 교체
        const headingIndex = originalFileContent.indexOf(heading);
        const nextHeadingRegex = /^#+\s/gm;
        nextHeadingRegex.lastIndex = headingIndex + heading.length;
        const nextMatch = nextHeadingRegex.exec(originalFileContent);
        const sectionEnd = nextMatch ? nextMatch.index : originalFileContent.length;

        const updatedFileContent =
            originalFileContent.substring(0, headingIndex) + // 섹션 이전 내용
            finalContent + // Ollama가 제안한 수정된 섹션 내용
            originalFileContent.substring(sectionEnd); // 섹션 이후 내용
        await fs.writeFile(filePath, updatedFileContent, "utf-8");

    } else {
         // heading이 없거나, 원래 없었거나, fallback 시에는 finalContent가 전체 파일 내용이 됨
         await fs.writeFile(filePath, finalContent, "utf-8");
    }


    return {
      content: [{
        type: "text",
        text: `${filePath} 파일에 성공적으로 내용을 업데이트했습니다. (Ollama 분석 포함)`,
      }],
    };
  } catch (error: any) {
     // 파일 시스템 오류 처리
     if (error.code === 'EACCES') { // Check specifically for permission errors
         throw new McpError(ErrorCode.InternalError, `파일 접근 권한이 없습니다: ${filePath}`);
     } else if (error.code === 'ENOENT') { // Handle case where file creation might have failed if it didn't exist
         // This might be redundant if write fails, but good to be specific
         throw new McpError(ErrorCode.InternalError, `파일 쓰기 실패 (파일이 존재하지 않았을 수 있음): ${filePath}`);
     }
     // 기타 오류
     console.error("README 업데이트 중 오류 발생:", error);
     throw new McpError(ErrorCode.InternalError, `README 업데이트 실패: ${error.message}`);
  }
});

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
