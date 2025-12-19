# ☁️ CloudSpace – Telegram-Powered Cloud Storage

> **Fast, private, and server-light cloud storage system.**

CloudSpace is a cloud storage solution built using **Node.js, Express, MongoDB, and the Telegram Bot API**. Files are streamed directly to Telegram servers instead of being stored on the hosting server disk. This architecture makes the system **cost-efficient, scalable, and secure**.

---

## 🚀 Features

### 🔐 Authentication & Security
- **Passport.js Authentication:** Secure login and registration.
- **Session Handling:** Managed via `express-session`.
- **Telegram Verification:** Mandatory account linking before uploading files.
- **Access Control:** Per-user isolation for files, folders, and shared links.

### ☁️ Cloud Storage (Telegram-backed)
- **Zero Disk Usage:** Files are streamed directly to Telegram.
- **File Support:**
  - 📄 Documents
  - 🖼 Images
  - 🎥 Videos (Supports range streaming)
- **Unlimited Storage:** Dependent only on Telegram's API limits.

### 📁 Folder System
- Create nested folder structures.
- Recursive folder deletion.
- Drag-and-drop file movement between folders.
- **Breadcrumb Navigation:** Intuitive navigation similar to Google Drive.

### 📤 Upload System
- **Drag & Drop:** Modern HTML5 upload interface.
- **Batch Uploads:** Support for multiple files simultaneously.
- **Real-time Progress:** Byte-level tracking (no fake progress bars).
- **Streaming:** Uses **Busboy** to stream data directly without buffering on disk.

### 🖱 Desktop-Like Experience
- **Selection Box:** Click and drag to select multiple files.
- **Multi-File Drag & Drop:** Move multiple items at once.
- **Bulk Actions:** Delete or move multiple files instantly.

### 🔗 Sharing & Preview
- **Public Links:** Generate shareable links for files and folders.
- **Recursive Sharing:** Sharing a folder grants access to its contents.
- **Previews:**
  - PDF Viewer
  - Image Gallery
  - Video Player (HTTP Range support for seeking)
- **Direct Downloads:** Stream files back to the client.

### 📊 Dashboard
- Visual storage usage statistics.
- Total file counter.
- Clean, responsive UI.

---

## 🛠 Tech Stack

| Component | Technologies |
| :--- | :--- |
| **Backend** | Node.js, Express.js, MongoDB (Mongoose), Passport.js, Busboy, Axios, node-telegram-bot-api |
| **Frontend** | EJS Templates, Vanilla JavaScript, HTML5 Drag & Drop, Modern CSS |

---

## 📂 Project Structure

```text
telegram-bot-cloud/
│
├── models/             # Mongoose Schemas
│   ├── User.js
│   ├── File.js
│   ├── Folder.js
│   ├── Share.js
│   └── FolderShare.js
│
├── routes/             # Express Routes
│   └── auth.js
│
├── bot/                # Telegram Bot Logic
│   └── bot.js
│
├── middleware/         # Auth & Utility Middleware
│   └── isLoggedIn.js
│
├── views/              # EJS Templates
│   ├── dashboard.ejs
│   ├── index.ejs
│   ├── profile.ejs
│   └── shared/
│       └── folder.ejs
│
├── public/             # Static Assets
│   ├── css/
│   └── js/
│
├── .env                # Environment Variables
├── app.js              # Entry Point
└── README.md


⚙️ Configuration

Create a .env file in the root directory and add the following credentials:

Code snippet

MONGO_URI=your_mongodb_connection_string SESSION_SECRET=your_secret_session_key BOT_TOKEN=your_telegram_bot_token 

▶️ Installation & Run

Clone the repository

Bash

git clone [https://github.com/your-username/cloudspace.git](https://github.com/your-username/cloudspace.git) cd cloudspace 

Install dependencies

Bash

npm install 

Start the server

Bash

node app.js 

Access the application Open your browser and navigate to:

http://localhost:4000 

🧠 Architecture (How It Works)

Upload: User selects a file on the dashboard.

Stream: The file is streamed through the server directly to the Telegram Bot API.

Metadata: The server saves the file_id (from Telegram) and metadata (name, size, type) to MongoDB. No file data is stored locally.

Retrieval: When a user requests a file, the server requests the download URL from Telegram and streams the response back to the browser.

⚠️ Important Notes

Telegram Verification: Users must link their Telegram account to the bot to enable upload functionality.

File Limits: Upload sizes are subject to Telegram Bot API limits (currently 50MB for bots, or 2GB if using local Bot API server).

Data Persistence: Do not delete the message history with the bot, as that contains the actual file data.

Server Storage: The application is stateless regarding file storage; storage usage on the host server remains near zero.

🌱 Future Improvements

[ ] Folder permissions (Read-only vs Read/Write)

[ ] Team/Group shared folders

[ ] File versioning history

[ ] End-to-end encryption before streaming to Telegram

[ ] Mobile-optimized drag selection

[ ] Advanced search indexing

[ ] Storage quota limits per user

👨‍💻 Author

Sameet Pisal

🎓 FY BTech Computer Science, MITAOE, Pune

🌐 Website: sameetpisal.vercel.app

⚙️ Configuration

Create a .env file in the root directory and add the following credentials:

Code snippet

MONGO_URI=your_mongodb_connection_string SESSION_SECRET=your_secret_session_key BOT_TOKEN=your_telegram_bot_token 

▶️ Installation & Run

Clone the repository

Bash

git clone [https://github.com/your-username/cloudspace.git](https://github.com/your-username/cloudspace.git) cd cloudspace 

Install dependencies

Bash

npm install 

Start the server

Bash

node app.js 

Access the application Open your browser and navigate to:

http://localhost:4000 

🧠 Architecture (How It Works)

Upload: User selects a file on the dashboard.

Stream: The file is streamed through the server directly to the Telegram Bot API.

Metadata: The server saves the file_id (from Telegram) and metadata (name, size, type) to MongoDB. No file data is stored locally.

Retrieval: When a user requests a file, the server requests the download URL from Telegram and streams the response back to the browser.

⚠️ Important Notes

Telegram Verification: Users must link their Telegram account to the bot to enable upload functionality.

File Limits: Upload sizes are subject to Telegram Bot API limits (currently 50MB for bots, or 2GB if using local Bot API server).

Data Persistence: Do not delete the message history with the bot, as that contains the actual file data.

Server Storage: The application is stateless regarding file storage; storage usage on the host server remains near zero.

🌱 Future Improvements

[ ] Folder permissions (Read-only vs Read/Write)

[ ] Team/Group shared folders

[ ] File versioning history

[ ] End-to-end encryption before streaming to Telegram

[ ] Mobile-optimized drag selection

[ ] Advanced search indexing

[ ] Storage quota limits per user

👨‍💻 Author

Sameet Pisal

🎓 FY BTech Computer Science, MITAOE, Pune

🌐 Website: sameetpisal.vercel.app



