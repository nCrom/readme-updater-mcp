# readme-updater-mcp

[![smithery badge](https://smithery.ai/badge/@nCrom/readme-updater-mcp)](https://smithery.ai/server/@nCrom/readme-updater-mcp)

Ollama를 사용하여 의미 충돌을 분석하고 README.md 파일을 업데이트하는 MCP 서버입니다.

## 기능

*   지정된 README.md 파일에 내용을 추가합니다.
*   내용 추가 시 Ollama (`llama3` 모델 사용)를 통해 기존 내용과의 의미 충돌을 분석합니다.
*   충돌이 감지되면 Ollama의 제안에 따라 기존 내용을 수정하거나 삭제 후 새 내용을 추가하려고 시도합니다.
*   Ollama 분석에 실패하면, 충돌 감지 없이 내용을 추가하는 방식으로 동작합니다 (Fallback).

## 사전 요구 사항

*   [Node.js](https://nodejs.org/) (최신 LTS 버전 권장)
*   [Ollama](https://ollama.com/) 설치
*   Ollama `llama3` 모델 다운로드:
    ```bash
    ollama pull llama3
    ```

## 설치

### Installing via Smithery

To install readme-updater-mcp for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@nCrom/readme-updater-mcp):

```bash
npx -y @smithery/cli install @nCrom/readme-updater-mcp --client claude
```

### Manual Installation
1.  **저장소 클론:**
    ```bash
    git clone https://github.com/nCrom/readme-updater-mcp.git
    ```
2.  **디렉토리 이동:**
    ```bash
    cd readme-updater-mcp
    ```
3.  **의존성 설치:**
    ```bash
    npm install
    ```
4.  **(선택 사항) 빌드:** 서버 실행 시 자동으로 빌드될 수 있지만, 수동으로 빌드하려면 다음 명령어를 실행합니다.
    ```bash
    npm run build
    ```

## MCP 클라이언트 설정

사용하는 MCP 클라이언트(예: Cline, Claude Desktop 등)의 설정 파일에 이 서버를 등록해야 합니다.

*   **Windows (Claude Desktop 예시):** `%APPDATA%/Claude/claude_desktop_config.json`
*   **macOS (Claude Desktop 예시):** `~/Library/Application Support/Claude/claude_desktop_config.json`
*   **Cline (VS Code 확장 프로그램 예시):** `c:/Users/[사용자명]/AppData/Roaming/Windsurf/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` (경로는 다를 수 있음)

설정 파일의 `mcpServers` 객체 안에 다음 내용을 추가합니다. `args`의 경로는 실제 서버 코드를 다운로드한 경로로 수정해야 합니다.

```json
{
  "mcpServers": {
    // ... 다른 서버 설정들 ...
    "readme-updater-mcp": {
      "command": "node",
      "args": [
        // 예시: "C:/path/to/downloaded/readme-updater-mcp/build/index.js"
        // 실제 서버 build/index.js 파일의 전체 경로로 수정하세요.
        "/full/path/to/readme-updater-mcp/build/index.js"
      ],
      "env": {
        // 로컬 Ollama API 주소 설정 (기본값과 동일하다면 생략 가능)
        "OLLAMA_HOST": "http://127.0.0.1:11434"
      },
      "disabled": false,
      "autoApprove": [] // 필요에 따라 자동 승인할 도구 추가
    }
  }
}
```

**참고:** MCP 클라이언트를 다시 시작해야 설정 변경 사항이 적용될 수 있습니다.

## 사용법

MCP 클라이언트(예: Cline)를 통해 `update_readme` 도구를 호출합니다.

**파라미터:**

*   `filePath` (필수): 업데이트할 README.md 파일의 절대 경로 (문자열)
*   `contentToAppend` (필수): README 파일에 추가할 내용 (문자열)
*   `heading` (선택): 내용을 추가할 Markdown 제목 (문자열, 예: "## 변경 기록"). 지정하지 않거나 해당 제목이 없으면 파일 끝에 추가됩니다.

**예시 요청 (Cline 사용 시):**

"마지막 커밋 메시지를 `D:/my-project/README.md` 파일의 `## 커밋 로그` 아래에 추가해줘."
