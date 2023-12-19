import { Telegraf, Context } from 'telegraf';
import { CallbackQuery, Update } from 'telegraf/types';
import { config } from './config';
import WalletManager from './WalletManager';
import { Database } from './db';
import { CronJob } from 'cron';
import { wait } from './utils';
import { getDailyReport, subscribe } from './messages';
import { NotificationType, NotificationTypeNames } from './types';

if (!config.BotToken) {
  throw new Error('Bot token missing!');
}

const bot = new Telegraf<Context<Update>>(config.BotToken);
const db = new Database();

bot.start(async (ctx) => {
  try {
    const { chat } = ctx.message;

    if (chat.type === 'private') {
      ctx.sendMessage(
        `*Let's get started*\n\nAdd me to a group and follow the instructions to get started.`,
        {
          parse_mode: 'Markdown',
        }
      );
      return;
    }
  } catch (err) {
    console.log('An error occured when executing the start command', err);
  }
});

bot.command('walletmanager', async (ctx) => {
  if (!config.WalletManagerEndpoint) {
    ctx.reply('Wallet manager endpoint is not configured');
    return;
  }

  const output = await WalletManager.report(config.WalletManagerEndpoint);

  ctx.reply(output, {
    parse_mode: 'Markdown',
  });
});

bot.on('my_chat_member', async (ctx) => {
  if (ctx.update.my_chat_member.new_chat_member.user.id !== bot.botInfo?.id) {
    return;
  }

  if (
    ctx.update.my_chat_member.new_chat_member.status === 'kicked' ||
    ctx.update.my_chat_member.new_chat_member.status === 'left'
  ) {
    try {
      // clear by chat id
      await db.deleteByChatId(ctx.chat.id);
    } catch (err) {
      console.log('An error occured when clearing db', err);
    }
    return;
  }

  if (ctx.update.my_chat_member.new_chat_member.status !== 'member') {
    return;
  }

  // send admin message to subscribe to notifications
  await subscribe(ctx, ctx.update.my_chat_member.from.id);
});

bot.command('subscribe', async (ctx) => {
  if (!ctx.from) {
    return;
  }

  await subscribe(ctx, ctx.from.id);
});

bot.action(/^subscribe:/g, async (ctx) => {
  try {
    if (!ctx.callbackQuery) {
      throw new Error();
    }

    const chatId = ctx.callbackQuery.message?.chat.id;
    const notificationType = (ctx.callbackQuery as CallbackQuery.DataQuery).data.split(
      ':'
    )[1] as NotificationType;

    if (!chatId) {
      throw new Error();
    }

    await db.insert({ chatId, notificationType });

    ctx.answerCbQuery(`You have subscribed to ${NotificationTypeNames[notificationType]}.`, {
      show_alert: true,
    });
    ctx.deleteMessage();
  } catch (err) {
    let message = 'An error occured when subscribing';

    const error = err as Error;

    if (error.message) {
      message += `: ${error.message}`;
    }

    ctx.answerCbQuery(message, { show_alert: true });
  }
});

const dailyReportScheduler = new CronJob('0 0 12 * * *', async () => {
  // Your post_info_proposals_daily logic here
  console.log('Running dailyReportScheduler...');

  const notifications = await db.getAll();

  for (const { chatId, notificationType } of notifications) {
    try {
      const message = await getDailyReport(notificationType);
      await bot.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
      });
      await wait(1000);
    } catch (err) {
      console.log('An error occurred when sending daily report', err);
      // Handle the error (retry, notify user, etc.)
    }
  }
});

bot.telegram.setMyCommands([
  {
    command: 'walletmanager',
    description: 'Get the status of the wallet manager',
  },
  {
    command: 'subscribe',
    description: 'Subscribe to notifications',
  },
]);

bot.launch();
dailyReportScheduler.start();

console.log('Orbs Status Bot is up and running!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
