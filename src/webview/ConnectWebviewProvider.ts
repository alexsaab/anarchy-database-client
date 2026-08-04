import * as vscode from 'vscode';
import { ConnectionStorageService } from '../storage/ConnectionStorage.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { isRussian, t } from '../util/i18n.js';

export class ConnectWebviewProvider {
  public static show(
    context: vscode.ExtensionContext,
    storageService: ConnectionStorageService,
    onSaved: () => void,
    editingConfig?: ConnectionConfig,
    existingPassword?: string,
    existingSshPassword?: string
  ) {
    const isEdit = !!editingConfig;
    const title = isEdit ? t('Edit Connection', 'Редактировать подключение') : t('Add Connection', 'Добавить подключение');

    const panel = vscode.window.createWebviewPanel(
      'dbClientConnect',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'test': {
          try {
            const tempConfig: ConnectionConfig = message.data.config;
            const password = message.data.password;
            const sshPassword = message.data.sshPassword;
            const driver = await DriverManager.getInstance().getDriver(tempConfig, password, sshPassword);
            const res = await driver.testConnection();
            panel.webview.postMessage({ type: 'testResult', result: res });
          } catch (err: any) {
            panel.webview.postMessage({
              type: 'testResult',
              result: { success: false, message: err.message || 'Connection test failed' },
            });
          }
          break;
        }
        case 'save': {
          try {
            const config: ConnectionConfig = message.data.config;
            const password = message.data.password;
            const sshPassword = message.data.sshPassword;

            await storageService.saveConnection(config);
            if (password !== undefined) {
              await storageService.savePassword(config.id, password);
            }
            if (sshPassword !== undefined) {
              await storageService.saveSshPassword(config.id, sshPassword);
            }

            vscode.window.showInformationMessage(
              t(`Successfully saved connection "${config.name}"!`, `Подключение "${config.name}" успешно сохранено!`)
            );
            onSaved();
            panel.dispose();
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to save connection: ${err.message}`);
          }
          break;
        }
      }
    });

    panel.webview.html = ConnectWebviewProvider.getHtml(editingConfig, existingPassword, existingSshPassword);
  }

  private static getHtml(
    config?: ConnectionConfig,
    password?: string,
    sshPassword?: string
  ): string {
    const ru = isRussian();
    const text = {
      title: config ? (ru ? 'Редактировать Подключение' : 'Edit Database Connection') : (ru ? 'Новое Подключение к Базе Данных' : 'New Database Connection'),
      name: ru ? 'Имя подключения' : 'Connection Name',
      namePh: ru ? 'Мой Проект DB' : 'My Project DB',
      group: ru ? 'Группа / Проект' : 'Group / Folder',
      groupPh: ru ? 'Production, Staging, Local' : 'Production, Staging, Local',
      color: ru ? 'Цветовая метка' : 'Color Badge',
      dbType: ru ? 'Тип СУБД' : 'Database Type',
      host: ru ? 'Хост' : 'Host',
      port: ru ? 'Порт' : 'Port',
      user: ru ? 'Пользователь' : 'User',
      password: ru ? 'Пароль / API Key / Token' : 'Password / API Key / Token',
      database: ru ? 'База данных / Project ID' : 'Database / Project ID',
      dbPath: ru ? 'Путь к файлу базы (.db)' : 'Database File Path (.db)',
      dbPathPh: ru ? '/path/to/database.db' : '/path/to/database.db',
      sshSection: ru ? '🔒 SSH Туннель' : '🔒 SSH Tunnel',
      sshEnable: ru ? 'Использовать SSH туннелирование' : 'Use SSH Tunnel',
      sshHost: ru ? 'SSH Хост' : 'SSH Host',
      sshPort: ru ? 'SSH Порт' : 'SSH Port',
      sshUser: ru ? 'SSH Пользователь' : 'SSH User',
      sshPass: ru ? 'SSH Пароль' : 'SSH Password',
      usePk: ru ? 'Использовать SSH Ключ (Private Key)' : 'Use Private Key File',
      pkPath: ru ? 'Путь к Private Key' : 'Private Key Path',
      testBtn: ru ? '⚡ Проверить Соединение' : '⚡ Test Connection',
      saveBtn: ru ? '💾 Сохранить Подключение' : '💾 Save Connection',
    };

    const configJson = JSON.stringify(config || null);
    const passJson = JSON.stringify(password || '');
    const sshPassJson = JSON.stringify(sshPassword || '');

    return `<!DOCTYPE html>
<html lang="${ru ? 'ru' : 'en'}">
<head>
  <meta charset="UTF-8">
  <title>${text.title}</title>
  <style>
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      max-width: 550px;
      margin: 0 auto;
    }
    h2 {
      margin-bottom: 20px;
      color: var(--vscode-symbolIcon-keywordForeground, #007acc);
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      padding-bottom: 8px;
    }
    .form-group {
      margin-bottom: 15px;
    }
    label {
      display: block;
      margin-bottom: 5px;
      font-size: 13px;
      font-weight: 600;
    }
    input, select {
      width: 100%;
      padding: 8px;
      box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 4px;
    }
    .row {
      display: flex;
      gap: 10px;
    }
    .col {
      flex: 1;
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-top: 25px;
    }
    button {
      flex: 1;
      padding: 10px;
      font-weight: bold;
      border-radius: 4px;
      border: none;
      cursor: pointer;
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .color-picker {
      display: flex;
      gap: 8px;
      margin-top: 5px;
    }
    .color-dot {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      cursor: pointer;
      border: 2px solid transparent;
    }
    .color-dot.selected {
      border-color: #ffffff;
      transform: scale(1.15);
    }
    #status {
      margin-top: 15px;
      padding: 10px;
      border-radius: 4px;
      display: none;
      font-size: 13px;
    }
    #status.success {
      background: #1e3a1e;
      color: #4ade80;
      border: 1px solid #22c55e;
    }
    #status.error {
      background: #451a1a;
      color: #f87171;
      border: 1px solid #ef4444;
    }
    .section-title {
      font-weight: bold;
      margin-top: 20px;
      margin-bottom: 10px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
    }
  </style>
</head>
<body>
  <h2>${text.title}</h2>

  <div class="form-group">
    <label>${text.name}</label>
    <input type="text" id="name" placeholder="${text.namePh}">
  </div>

  <div class="row">
    <div class="form-group col">
      <label>${text.group}</label>
      <input type="text" id="group" placeholder="${text.groupPh}">
    </div>
    <div class="form-group col">
      <label>${text.color}</label>
      <div class="color-picker">
        <div class="color-dot" style="background: #3b82f6;" data-color="#3b82f6"></div>
        <div class="color-dot" style="background: #10b981;" data-color="#10b981"></div>
        <div class="color-dot" style="background: #f59e0b;" data-color="#f59e0b"></div>
        <div class="color-dot" style="background: #ef4444;" data-color="#ef4444"></div>
        <div class="color-dot" style="background: #8b5cf6;" data-color="#8b5cf6"></div>
        <div class="color-dot" style="background: #ec4899;" data-color="#ec4899"></div>
      </div>
    </div>
  </div>

  <div class="form-group">
    <label>${text.dbType}</label>
    <select id="type" onchange="onTypeChange()">
      <option value="PostgreSQL">PostgreSQL</option>
      <option value="MySQL">MySQL / MariaDB</option>
      <option value="SQLite">SQLite</option>
      <option value="Redis">Redis</option>
      <option value="MongoDB">MongoDB</option>
      <option value="Elasticsearch">Elasticsearch</option>
      <option value="ClickHouse">ClickHouse</option>
      <option value="CouchDB">Apache CouchDB</option>
      <option value="Couchbase">Couchbase</option>
      <option value="Firestore">Firebase Firestore</option>
    </select>
  </div>

  <div id="standardFields">
    <div class="row">
      <div class="form-group col" style="flex: 3;">
        <label>${text.host}</label>
        <input type="text" id="host" value="localhost">
      </div>
      <div class="form-group col" style="flex: 1;">
        <label>${text.port}</label>
        <input type="number" id="port" value="5432">
      </div>
    </div>

    <div class="row">
      <div class="form-group col">
        <label>${text.user}</label>
        <input type="text" id="user" value="postgres">
      </div>
      <div class="form-group col">
        <label>${text.password}</label>
        <input type="password" id="password" value="">
      </div>
    </div>

    <div class="form-group">
      <label>${text.database}</label>
      <input type="text" id="database" value="postgres">
    </div>
  </div>

  <div id="sqliteFields" style="display:none;">
    <div class="form-group">
      <label>${text.dbPath}</label>
      <input type="text" id="dbPath" placeholder="${text.dbPathPh}">
    </div>
  </div>

  <div class="section-title">${text.sshSection}</div>
  <div class="form-group">
    <label><input type="checkbox" id="sshEnabled" onchange="toggleSshFields()"> ${text.sshEnable}</label>
  </div>
  <div id="sshFields" style="display:none;">
    <div class="row">
      <div class="form-group col" style="flex: 3;">
        <label>${text.sshHost}</label>
        <input type="text" id="sshHost" placeholder="ssh.example.com">
      </div>
      <div class="form-group col" style="flex: 1;">
        <label>${text.sshPort}</label>
        <input type="number" id="sshPort" value="22">
      </div>
    </div>
    <div class="row">
      <div class="form-group col">
        <label>${text.sshUser}</label>
        <input type="text" id="sshUsername">
      </div>
      <div class="form-group col">
        <label>${text.sshPass}</label>
        <input type="password" id="sshPassword">
      </div>
    </div>
    <div class="form-group">
      <label><input type="checkbox" id="usePrivateKey" onchange="togglePrivateKey()"> ${text.usePk}</label>
    </div>
    <div class="form-group" id="pkFileGroup" style="display:none;">
      <label>${text.pkPath}</label>
      <input type="text" id="privateKeyPath" placeholder="/home/user/.ssh/id_rsa">
    </div>
  </div>

  <div class="actions">
    <button class="secondary" id="testBtn">${text.testBtn}</button>
    <button class="primary" id="saveBtn">${text.saveBtn}</button>
  </div>

  <div id="status"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const initial = ${configJson};
    const initPassword = ${passJson};
    const initSshPassword = ${sshPassJson};

    let currentId = initial ? initial.id : ('conn_' + Date.now());
    let selectedColor = initial && initial.color ? initial.color : 'default';

    document.querySelectorAll('.color-dot').forEach(dot => {
      dot.classList.remove('selected');
      if (dot.getAttribute('data-color') === selectedColor) {
        dot.classList.add('selected');
      }
      dot.onclick = () => {
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
        dot.classList.add('selected');
        selectedColor = dot.getAttribute('data-color');
      };
    });

    if (initial) {
      document.getElementById('name').value = initial.name || '';
      document.getElementById('group').value = initial.group || '';
      document.getElementById('type').value = initial.type || 'PostgreSQL';
      document.getElementById('host').value = initial.host || 'localhost';
      document.getElementById('port').value = initial.port || 5432;
      document.getElementById('user').value = initial.user || '';
      document.getElementById('password').value = initPassword || '';
      document.getElementById('database').value = initial.database || '';
      document.getElementById('dbPath').value = initial.dbPath || '';
      if (initial.ssh && initial.ssh.enabled) {
        document.getElementById('sshEnabled').checked = true;
        document.getElementById('sshHost').value = initial.ssh.host || '';
        document.getElementById('sshPort').value = initial.ssh.port || 22;
        document.getElementById('sshUsername').value = initial.ssh.username || '';
        document.getElementById('sshPassword').value = initSshPassword || '';
        document.getElementById('usePrivateKey').checked = !!initial.ssh.usePrivateKey;
        document.getElementById('privateKeyPath').value = initial.ssh.privateKeyPath || '';
      }
      onTypeChange();
      toggleSshFields();
      togglePrivateKey();
    }

    function onTypeChange() {
      const type = document.getElementById('type').value;
      const portInput = document.getElementById('port');
      const standard = document.getElementById('standardFields');
      const sqlite = document.getElementById('sqliteFields');

      if (type === 'SQLite') {
        standard.style.display = 'none';
        sqlite.style.display = 'block';
      } else {
        standard.style.display = 'block';
        sqlite.style.display = 'none';
        if (!initial) {
          if (type === 'PostgreSQL') portInput.value = 5432;
          if (type === 'MySQL') portInput.value = 3306;
          if (type === 'Redis') portInput.value = 6379;
          if (type === 'MongoDB') portInput.value = 27017;
          if (type === 'Elasticsearch') portInput.value = 9200;
          if (type === 'ClickHouse') portInput.value = 8123;
          if (type === 'CouchDB') portInput.value = 5984;
          if (type === 'Couchbase') portInput.value = 8091;
          if (type === 'Firestore') portInput.value = 443;
        }
      }
    }

    function toggleSshFields() {
      const enabled = document.getElementById('sshEnabled').checked;
      document.getElementById('sshFields').style.display = enabled ? 'block' : 'none';
    }

    function togglePrivateKey() {
      const enabled = document.getElementById('usePrivateKey').checked;
      document.getElementById('pkFileGroup').style.display = enabled ? 'block' : 'none';
    }

    function getConfig() {
      const type = document.getElementById('type').value;
      return {
        config: {
          id: currentId,
          name: document.getElementById('name').value,
          group: document.getElementById('group').value,
          color: selectedColor,
          type: type,
          host: document.getElementById('host').value,
          port: parseInt(document.getElementById('port').value, 10),
          user: document.getElementById('user').value,
          database: document.getElementById('database').value,
          dbPath: document.getElementById('dbPath').value,
          ssh: {
            enabled: document.getElementById('sshEnabled').checked,
            host: document.getElementById('sshHost').value,
            port: parseInt(document.getElementById('sshPort').value, 10) || 22,
            username: document.getElementById('sshUsername').value,
            usePrivateKey: document.getElementById('usePrivateKey').checked,
            privateKeyPath: document.getElementById('privateKeyPath').value,
          }
        },
        password: document.getElementById('password').value,
        sshPassword: document.getElementById('sshPassword').value,
      };
    }

    document.getElementById('testBtn').onclick = () => {
      const status = document.getElementById('status');
      status.style.display = 'block';
      status.className = '';
      status.innerText = '${ru ? 'Проверка соединения...' : 'Testing connection...'}';
      vscode.postMessage({ type: 'test', data: getConfig() });
    };

    document.getElementById('saveBtn').onclick = () => {
      const data = getConfig();
      if (!data.config.name) {
        alert('${ru ? 'Пожалуйста, введите имя подключения' : 'Please enter a connection name'}');
        return;
      }
      vscode.postMessage({ type: 'save', data: data });
    };

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'testResult') {
        const status = document.getElementById('status');
        status.style.display = 'block';
        if (message.result.success) {
          status.className = 'success';
          status.innerText = '✅ ' + (message.result.message || 'Connection successful!');
        } else {
          status.className = 'error';
          status.innerText = '❌ ' + (message.result.message || 'Connection failed');
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
