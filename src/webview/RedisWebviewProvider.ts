import * as vscode from 'vscode';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { RedisDriver } from '../drivers/RedisDriver.js';
import { isRussian, t } from '../util/i18n.js';

export class RedisWebviewProvider {
  public static async show(connectionConfig: ConnectionConfig, password?: string, sshPassword?: string) {
    const title = t(`Redis Manager: ${connectionConfig.name}`, `Redis Менеджер: ${connectionConfig.name}`);
    const panel = vscode.window.createWebviewPanel(
      'dbClientRedis',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    try {
      const driver = (await DriverManager.getInstance().getDriver(connectionConfig, password, sshPassword)) as RedisDriver;

      const loadKeys = async (pattern: string = '*') => {
        try {
          await driver.connect();
          const keys = await driver.getTables();
          const keyDetails: any[] = [];

          for (const k of keys.slice(0, 100)) {
            const keyName = k.name;
            let type = 'string';
            let ttl = -1;
            try {
              type = await driver.getKeyType(keyName);
              ttl = await driver.getKeyTtl(keyName);
            } catch (e) {}

            keyDetails.push({ key: keyName, type, ttl });
          }

          panel.webview.postMessage({ type: 'renderKeys', keys: keyDetails });
        } catch (err: any) {
          panel.webview.postMessage({ type: 'error', message: err.message });
        }
      };

      panel.webview.onDidReceiveMessage(async (msg) => {
        switch (msg.type) {
          case 'searchKeys':
            await loadKeys(msg.pattern);
            break;
          case 'getValue':
            try {
              const val = await driver.getKeyValue(msg.key);
              const ttl = await driver.getKeyTtl(msg.key);
              const keyType = await driver.getKeyType(msg.key);
              panel.webview.postMessage({ type: 'renderValue', key: msg.key, value: val, ttl, keyType });
            } catch (err: any) {
              panel.webview.postMessage({ type: 'error', message: err.message });
            }
            break;
          case 'saveValue':
            try {
              await driver.setKeyValue(msg.key, msg.value, msg.ttl);
              vscode.window.showInformationMessage(t(`Saved Redis key "${msg.key}"`, `Ключ Redis "${msg.key}" сохранен`));
              await loadKeys();
            } catch (err: any) {
              panel.webview.postMessage({ type: 'error', message: err.message });
            }
            break;
          case 'deleteKey':
            try {
              await driver.deleteKey(msg.key);
              vscode.window.showInformationMessage(t(`Deleted key "${msg.key}"`, `Ключ "${msg.key}" удален`));
              await loadKeys();
            } catch (err: any) {
              panel.webview.postMessage({ type: 'error', message: err.message });
            }
            break;
        }
      });

      panel.webview.html = RedisWebviewProvider.getHtml(connectionConfig.name);
      loadKeys();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to open Redis Manager: ${err.message}`);
    }
  }

  private static getHtml(connectionName: string): string {
    const ru = isRussian();

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
  <title>Redis Manager: ${connectionName}</title>
  <style>
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      margin: 0;
      padding: 15px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
    }
    .layout { display: flex; flex: 1; gap: 15px; overflow: hidden; }
    .sidebar {
      width: 320px;
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 6px;
      padding: 10px;
      display: flex;
      flex-direction: column;
    }
    .main-area {
      flex: 1;
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 6px;
      padding: 15px;
      display: flex;
      flex-direction: column;
    }
    input, select, textarea, button {
      padding: 8px 12px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 4px;
    }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; font-weight: bold; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .key-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      cursor: pointer;
      font-size: 13px;
    }
    .key-item:hover { background: rgba(255,255,255,0.08); }
    .badge { padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; background: #6366f1; color: #fff; }
    textarea { width: 100%; flex: 1; font-family: monospace; font-size: 13px; box-sizing: border-box; resize: none; }
    #errorBox { display: none; background: #7f1d1d; color: #fca5a5; padding: 10px; border-radius: 4px; margin-bottom: 10px; }
  </style>
</head>
<body>
  <h2>🔴 Redis Key-Value Manager: ${connectionName}</h2>

  <div id="errorBox"></div>

  <div class="layout">
    <div class="sidebar">
      <div style="display:flex; gap:6px; margin-bottom:10px;">
        <input type="text" id="searchInput" placeholder="user:*" value="*" style="flex:1;">
        <button id="searchBtn">🔍</button>
      </div>
      <div id="keysList" style="flex:1; overflow-y:auto;"></div>
    </div>

    <div class="main-area">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h3 id="currentKeyTitle">🔑 ${ru ? 'Выберите Ключ' : 'Select a Key'}</h3>
        <div style="display:flex; gap:10px; align-items:center;">
          <label>TTL (s):</label>
          <input type="number" id="ttlInput" value="-1" style="width:80px;">
          <button id="saveBtn" style="background:#059669;">💾 ${ru ? 'Сохранить' : 'Save'}</button>
          <button id="deleteBtn" style="background:#dc2626;">🗑️ ${ru ? 'Удалить' : 'Delete'}</button>
        </div>
      </div>
      <textarea id="valueEditor" placeholder="${ru ? 'Значение ключа...' : 'Key value...'}"></textarea>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let selectedKey = '';

    document.getElementById('searchBtn').onclick = () => {
      const pattern = document.getElementById('searchInput').value;
      vscode.postMessage({ type: 'searchKeys', pattern });
    };

    document.getElementById('saveBtn').onclick = () => {
      if (!selectedKey) return;
      const value = document.getElementById('valueEditor').value;
      const ttl = parseInt(document.getElementById('ttlInput').value, 10);
      vscode.postMessage({ type: 'saveValue', key: selectedKey, value, ttl });
    };

    document.getElementById('deleteBtn').onclick = () => {
      if (!selectedKey) return;
      if (confirm('${ru ? 'Удалить ключ' : 'Delete key'} "' + selectedKey + '"?')) {
        vscode.postMessage({ type: 'deleteKey', key: selectedKey });
      }
    };

    window.addEventListener('message', e => {
      const msg = e.data;
      const errorBox = document.getElementById('errorBox');
      if (msg.type === 'error') {
        errorBox.style.display = 'block';
        errorBox.innerText = '❌ Error: ' + msg.message;
        return;
      }

      if (msg.type === 'renderKeys') {
        errorBox.style.display = 'none';
        const list = document.getElementById('keysList');
        list.innerHTML = msg.keys.map(k => \`
          <div class="key-item" onclick="selectKey('\${k.key}')">
            <span>🔑 \${k.key}</span>
            <span class="badge">\${k.type} (\${k.ttl}s)</span>
          </div>
        \`).join('');
      }

      if (msg.type === 'renderValue') {
        errorBox.style.display = 'none';
        selectedKey = msg.key;
        document.getElementById('currentKeyTitle').innerText = '🔑 ' + msg.key + ' [' + msg.keyType + ']';
        document.getElementById('valueEditor').value = typeof msg.value === 'object' ? JSON.stringify(msg.value, null, 2) : msg.value;
        document.getElementById('ttlInput').value = msg.ttl;
      }
    });

    function selectKey(key) {
      vscode.postMessage({ type: 'getValue', key });
    }
  </script>
</body>
</html>`;
  }
}
