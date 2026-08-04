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
- 🔒 **SSH-Туннелирование**: Защищенное подключение к базами за файрволом с поддержкой парольной авторизации и SSH-ключей (`id_rsa`, `id_ed25519`).
- 📂 **Группировка и Проекты**: Объединение подключений в виртуальные папки-проекты (например, `Production`, `Staging`, `Local`).
- 🎨 **Цветовые метки (Color Badges)**: Визуальное выделение подключений яркими цветными иконками (Красный для Прода, Зеленый для Локала и т.д.).
- 📤 **Экспорт данных**: Быстрый экспорт таблиц и результатов запросов в **CSV**, **JSON** и **SQL INSERT** скрипты.
- ⚡ **SQL Консоль и IntelliSense**: Встроенный редактор запросов с подсветкой и автодополнением ключей SQL (`Ctrl+Enter` для запуска).
- 🌐 **Мультиязычность (i18n)**: Автоматическая локализация на **Русский** и **Английский** языки в зависимости от языка интерфейса VS Code.

---

## 🚀 Установка

### Вариант 1: Установка из `.vsix` файла (На любую машину)

1. Скачайте файл `anarchy-database-client-0.2.3.vsix` из раздела [Releases](https://github.com/alexsaab/anarchy-database-client/releases).
2. В VS Code откройте панель расширений (`Ctrl+Shift+X` или `Cmd+Shift+X`).
3. Нажмите на меню с тремя точками (`...`) в правом верхнем углу панели расширений.
4. Выберите **Установить из VSIX...** (**Install from VSIX...**) и укажите скачанный файл.

Или выполните команду в терминале:
```bash
code --install-extension anarchy-database-client-0.2.3.vsix
```

---

## 🛠 Запуск из исходного кода и сборка `.vsix`

Если вы хотите собрать расширение самостоятельно:

```bash
# 1. Клонируйте репозиторий
git clone https://github.com/alexsaab/anarchy-database-client.git
cd anarchy-database-client

# 2. Установите зависимости
npm install

# 3. Соберите проект
npm run build

# 4. Упакуйте в .vsix файл для распространения
npx @vscode/vsce package
```

После выполнения `npx @vscode/vsce package` в корневой папке появится готовый установочный файл `anarchy-database-client-0.2.3.vsix`.

---

## 📤 Инструкция по публикации на GitHub

Для публикации вашего проекта в репозитории [github.com/alexsaab](https://github.com/alexsaab/):

1. **Создайте новый публичный репозиторий** на GitHub с именем `anarchy-database-client`.
2. В терминале вашего проекта выполните:

```bash
git init
git add .
git commit -m "feat: Initial release of Anarchy Database Client v0.2.3"
git branch -M main
git remote add origin https://github.com/alexsaab/anarchy-database-client.git
git push -u origin main
```

---

## ⌨️ Горячие клавиши

| Сочетание | Действие |
| :--- | :--- |
| `Ctrl + Enter` / `Cmd + Enter` | Выполнить выделенный или текущий SQL-запрос в консоли |

---

## 📜 Лицензия

MIT License © 2026 [alexsaab](https://github.com/alexsaab)
