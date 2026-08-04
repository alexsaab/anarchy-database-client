# ⚡ Anarchy Database Client for VS Code

Полнофункциональное, быстрое и стильное расширение для работы с базами данных в **Visual Studio Code**, вдохновленное известным клиентом `cweijan.vscode-database-client2`.

![Anarchy DB Client Banner](resources/icon.png)

---

## ✨ Ключевые возможности

- 🐘 **PostgreSQL**: Поддержка баз данных, схем (`public` и пользовательских), таблиц, представлений (`VIEW`) и колонок.
- 🐬 **MySQL / MariaDB**: Быстрая работа через `mysql2`, включая просмотр таблиц, индексов и первичных ключей.
- 📁 **SQLite**: Просмотр локальных файлов баз данных (`.db`, `.sqlite`, `.sqlite3`).
- 🔴 **Redis**: Просмотр ключей, типов данных (`string`, `hash`, `list`, `set`), значений и времени жизни `TTL`.
- 🍃 **MongoDB**: Работа с коллекциями и BSON/JSON документами.
- 🔎 **Elasticsearch**: Подключение к кластерам Elasticsearch, просмотр индексов, маппингов (`mappings`) и документов.
- 🔒 **SSH-Туннелирование**: Защищенное подключение к базами за файрволом с поддержкой парольной авторизации и SSH-ключей (`id_rsa`, `id_ed25519`).
- 📂 **Группировка и Проекты**: Объединение подключений в виртуальные папки-проекты (например, `Production`, `Staging`, `Local`).
- 🎨 **Цветовые метки (Color Badges)**: Визуальное выделение подключений яркими цветными иконками (Красный для Прода, Зеленый для Локала и т.д.).
- 📤 **Экспорт данных**: Быстрый экспорт таблиц и результатов запросов в **CSV**, **JSON** и **SQL INSERT** скрипты.
- ⚡ **SQL Консоль и IntelliSense**: Встроенный редактор запросов с подсветкой и автодополнением ключей SQL (`Ctrl+Enter` для запуска).
- 🌐 **Мультиязычность (i18n)**: Динамическое переключение на **Русский** или **Английский** язык в зависимости от языка интерфейса VS Code.

---

## 🚀 Пошаговая инструкция по установке

### Способ 1: Установка готового `.vsix` файла (Для пользователей)

#### Через Графический Интерфейс VS Code:
1. Скачайте файл `anarchy-database-client-0.3.0.vsix` из раздела [Releases](https://github.com/alexsaab/anarchy-database-client/releases).
2. В VS Code откройте панель **Расширения** (`Ctrl + Shift + X` на Windows/Linux или `Cmd + Shift + X` на macOS).
3. Нажмите на значок **Троеточие (`...`)** в правом верхнем углу панели расширений.
4. Выберите пункт **Установить из VSIX...** (**Install from VSIX...**).
5. Укажите скачанный файл `anarchy-database-client-0.3.0.vsix` и нажмите **Установить**.

#### Через Командную Строку / Терминал:
```bash
code --install-extension anarchy-database-client-0.3.0.vsix
```

---

### Способ 2: Запуск и сборка из Исходного Кода (Для разработчиков)

Если вы хотите вносить изменения в код расширения или собрать его самостоятельно:

#### 1. Клонирование и подготовка:
```bash
# Клонируйте ваш репозиторий
git clone https://github.com/alexsaab/anarchy-database-client.git
cd anarchy-database-client

# Установите зависимые библиотеки
npm install

# Соберите проект
npm run build
```

#### 2. Запуск в режиме отладки (Debug Mode):
* Откройте папку `anarchy-database-client` в VS Code.
* Нажмите клавишу **`F5`** на клавиатуре.
* Откроется новое окно VS Code (*Extension Development Host*) с запущенным расширением.

#### 3. Упаковка в установочный `.vsix` пакет:
```bash
npx @vscode/vsce package
```
После завершения команды в корне проекта появится новый файл `anarchy-database-client-0.3.0.vsix`.

---

## 📤 Инструкция по обновлению и публикации на GitHub

Для отправки изменений в ваш репозиторий [github.com/alexsaab/anarchy-database-client](https://github.com/alexsaab/anarchy-database-client):

```bash
git add .
git commit -m "feat: Add Elasticsearch support and update installation guide"
git push origin main
```

---

## ⌨️ Горячие клавиши

| Сочетание | Действие |
| :--- | :--- |
| `Ctrl + Enter` / `Cmd + Enter` | Выполнить выделенный или текущий SQL-запрос в консоли |

---

## 📜 Лицензия

MIT License © 2026 [alexsaab](https://github.com/alexsaab)
