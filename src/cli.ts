#!/usr/bin/env node

import { cmdLogin } from "./commands/login.js";
import { cmdSend } from "./commands/send.js";
import { cmdListen } from "./commands/listen.js";
import { cmdChat } from "./commands/chat.js";
import { cmdAccounts } from "./commands/accounts.js";
import { cmdPaste } from "./commands/paste.js";
import { cmdSendFile } from "./commands/sendfile.js";
import { error } from "./utils.js";

function printHelp(): void {
  console.log(`
  weixin - 微信 CLI 消息工具

  用法: weixin <命令> [参数]

  命令:
    (无参数)                            发送剪贴板内容到绑定的微信
    login                              扫码登录微信
    accounts                           查看已登录账号
    send <user_id> <message>           发送消息给指定用户
    sendfile <file> [--to id] [--cap]  发送文件/图片/视频
    listen                             监听并打印所有收到的消息
    chat [user_id]                     交互式聊天（可选指定对话对象）
    help                               显示帮助信息

  示例:
    weixin                                       # 发送剪贴板内容
    weixin login
    weixin listen
    weixin send "user123@im.wechat" "你好"
    weixin sendfile photo.jpg                    # 发图片给自己
    weixin sendfile doc.pdf --to "user@im.wechat"
    weixin sendfile demo.mp4 --caption "看这个"
    weixin chat
    weixin chat "user123@im.wechat"

  数据存储在 ~/.weixin/
`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "login":
      await cmdLogin();
      break;

    case "accounts":
      cmdAccounts();
      break;

    case "send": {
      const to = args[0];
      const text = args.slice(1).join(" ");
      if (!to || !text) {
        error("用法: weixin send <user_id> <message>");
        process.exit(1);
      }
      await cmdSend(to, text);
      break;
    }

    case "sendfile": {
      const filePath = args[0];
      if (!filePath) {
        error("用法: weixin sendfile <file> [--to <user_id>] [--caption <text>]");
        process.exit(1);
      }
      let to: string | undefined;
      let caption: string | undefined;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--to" && args[i + 1]) {
          to = args[++i];
        } else if ((args[i] === "--caption" || args[i] === "--cap") && args[i + 1]) {
          caption = args[++i];
        }
      }
      await cmdSendFile(filePath, to, caption);
      break;
    }

    case "listen":
      await cmdListen();
      break;

    case "chat":
      await cmdChat(args[0]);
      break;

    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;

    default:
      if (!command) {
        await cmdPaste();
        break;
      }
      error(`未知命令: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  error(String(err));
  process.exit(1);
});
