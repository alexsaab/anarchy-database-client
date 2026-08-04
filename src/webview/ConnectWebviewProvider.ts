import * as vscode from 'vscode';
import { ConnectionStorageService } from '../storage/ConnectionStorage.js';
import { DriverManager } from '../drivers/DriverManager.js';
import { ConnectionConfig } from '../model/ConnectionConfig.js';
import { isRussian, t } from '../util/i18n.js';

export class ConnectWebviewProvider {
  public static currentPanel: vscode.WebviewPanel | undefined;

  public static show(
    context: vscode.ExtensionContext,
    storageService: ConnectionStorageService,
    onSaveSuccess: () => void,
    editingConfig?: ConnectionConfig,
    initialPassword?: string,
    initialSshPassword?: string
  ) {
    if (ConnectWebviewProvider.currentPanel) {
      ConnectWebviewProvider.currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panelTitle = editingConfig
      ? t(`Edit: ${editingConfig.name}`, `Редактирование: ${editingConfig.name}`)
      : t('New Database Connection', 'Новое подключение к БД');

    const panel = vscode.window.createWebviewPanel(
      'addConnection',
      panelTitle,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    ConnectWebviewProvider.currentPanel = panel;
    panel.webview.html = ConnectWebviewProvider.getHtml(editingConfig, initialPassword, initialSshPassword);

    panel.onDidDispose(() => {
      ConnectWebviewProvider.currentPanel = undefined;
    });

    panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'testConnection': {
          try {
            const config: ConnectionConfig = message.config;
            const driver = await DriverManager.getInstance().getDriver(config, message.password, message.sshPassword);
            const result = await driver.testConnection();
            panel.webview.postMessage({ type: 'testResult', result });
          } catch (err: any) {
            panel.webview.postMessage({ type: 'testResult', result: { success: false, message: err.message } });
          }
          break;
        }
        case 'saveConnection': {
          const config: ConnectionConfig = message.config;
          await DriverManager.getInstance().removeDriver(config.id);
          await storageService.saveConnection(config, message.password, message.sshPassword);
          const savedMsg = t(`Connection "${config.name}" saved successfully!`, `Подключение "${config.name}" успешно сохранено!`);
          vscode.window.showInformationMessage(savedMsg);
          panel.dispose();
          onSaveSuccess();
          break;
        }
      }
    });
  }

  private static getHtml(initialConfig?: ConnectionConfig, initialPassword?: string, initialSshPassword?: string): string {
    const configJson = JSON.stringify(initialConfig || null);
    const passJson = JSON.stringify(initialPassword || '');
    const sshPassJson = JSON.stringify(initialSshPassword || '');
    const ru = isRussian();

    const text = {
      title: ru ? '⚙️ Настройка подключения (Anarchy DB)' : '⚙️ Connection Configuration (Anarchy DB)',
      connName: ru ? 'Имя подключения' : 'Connection Name',
      connNamePh: ru ? 'например, Production PostgreSQL' : 'e.g. Production PostgreSQL',
      group: ru ? 'Группа / Проект' : 'Group / Project',
      groupPh: ru ? 'например, Production, Dev' : 'e.g. Production, Dev',
      colorBadge: ru ? 'Цвет метки подключения' : 'Connection Color / Badge',
      colorDefault: ru ? 'По умолчанию' : 'Default',
      colorRed: ru ? 'Красный (Production)' : 'Red (Production)',
      colorOrange: ru ? 'Оранжевый' : 'Orange',
      colorYellow: ru ? 'Желтый (Staging)' : 'Yellow (Staging)',
      colorGreen: ru ? 'Зеленый (Local)' : 'Green (Local)',
      colorBlue: ru ? 'Синий' : 'Blue',
      colorPurple: ru ? 'Фиолетовый' : 'Purple',
      dbType: ru ? 'Тип СУБД' : 'Database Type',
      host: ru ? 'Хост (Host)' : 'Host',
      port: ru ? 'Порт' : 'Port',
      user: ru ? 'Пользователь' : 'User',
      password: ru ? 'Пароль' : 'Password',
      database: ru ? 'Имя базы данных' : 'Database Name',
      dbPath: ru ? 'Путь к файлу базы данных (.db, .sqlite)' : 'Database File Path (.db, .sqlite)',
      dbPathPh: '/path/to/database.sqlite',
      sshSection: ru ? '🔒 SSH-Туннелирование (Опционально)' : '🔒 SSH Tunneling (Optional)',
      sshEnable: ru ? 'Включить SSH-туннель' : 'Enable SSH Tunnel',
      sshHost: ru ? 'SSH Хост' : 'SSH Host',
      sshPort: ru ? 'SSH Порт' : 'SSH Port',
      sshUser: ru ? 'Имя пользователя SSH' : 'SSH Username',
      sshPass: ru ? 'Пароль SSH / Passphrase' : 'SSH Password / Passphrase',
      usePk: ru ? 'Использовать файл приватного ключа' : 'Use Private Key File',
      pkPath: ru ? 'Путь к приватному ключу (~/.ssh/id_rsa)' : 'Private Key Path (~/.ssh/id_rsa)',
      testBtn: ru ? 'Проверить соединение' : 'Test Connection',
      saveBtn: ru ? 'Сохранить подключение' : 'Save Connection',
      connecting: ru ? 'Подключение...' : 'Connecting...',
    };

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
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .color-picker {
      display: flex;
      gap: 10px;
      margin-top: 5px;
    }
    .color-dot {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      cursor: pointer;
      border: 2px solid transparent;
      box-sizing: border-box;
    }
    .color-dot.selected {
      border-color: #ffffff;
      transform: scale(1.15);
    }
    .section-title {
      font-size: 14px;
      font-weight: bold;
      margin-top: 20px;
      margin-bottom: 10px;
      border-bottom: 1px dashed var(--vscode-panel-border);
      padding-bottom: 4px;
    }
    #status {
      margin-top: 15px;
      padding: 10px;
      border-radius: 4px;
      display: none;
      font-size: 13px;
    }
    #status.success {
      display: block;
      background: #1b4d27;
      color: #98ecb3;
    }
    #status.error {
      display: block;
      background: #5a1d1d;
      color: #fca5a5;
    }
  </style>
</head>
<body>
  <h2>${text.title}</h2>
  
  <div class="row">
    <div class="form-group col" style="flex: 2;">
      <label>${text.connName}</label>
      <input type="text" id="name" value="${ru ? 'Моя База Данных' : 'My Database'}" placeholder="${text.connNamePh}">
    </div>
    <div class="form-group col" style="flex: 1;">
      <label>${text.group}</label>
      <input type="text" id="group" placeholder="${text.groupPh}">
    </div>
  </div>

  <div class="form-group">
    <label>${text.colorBadge}</label>
    <div class="color-picker">
      <div class="color-dot selected" data-color="default" style="background:#888;" title="${text.colorDefault}"></div>
      <div class="color-dot" data-color="red" style="background:#f87171;" title="${text.colorRed}"></div>
      <div class="color-dot" data-color="orange" style="background:#fb923c;" title="${text.colorOrange}"></div>
      <div class="color-dot" data-color="yellow" style="background:#facc15;" title="${text.colorYellow}"></div>
      <div class="color-dot" data-color="green" style="background:#4ade80;" title="${text.colorGreen}"></div>
      <div class="color-dot" data-color="blue" style="background:#60a5fa;" title="${text.colorBlue}"></div>
      <div class="color-dot" data-color="purple" style="background:#c084fc;" title="${text.colorPurple}"></div>
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

    document.getElementById('testBtn').addEventListener('click', () => {
      const status = document.getElementById('status');
      status.className = '';
      status.style.display = 'block';
      status.innerText = "${text.connecting}";
      vscode.postMessage({ type: 'testConnection', ...getConfig() });
    });

    document.getElementById('saveBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'saveConnection', ...getConfig() });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'testResult') {
        const status = document.getElementById('status');
        status.style.display = 'block';
        if (msg.result.success) {
          status.className = 'success';
          status.innerText = '✅ ' + msg.result.message;
        } else {
          status.className = 'error';
          status.innerText = '❌ ' + msg.result.message;
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
