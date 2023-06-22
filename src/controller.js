const { Telegraf } = require('telegraf');
const commandParts = require('telegraf-command-parts');
const { nanoid } = require('nanoid');

const { ServiceError } = require('./errors')

const MAX_MESSAGE_SIZE = 4000;
const SELF_BOT = 1;

class Controller {
    constructor(service, token, ownerId, functionContext) {
        this.bot = new Telegraf(token)
        this.service = service;
        this.functionContext = functionContext;
        this.ownerId = ownerId;
    }

    pt(items, plural, single) {
        return items && items.length > 1 ? plural : single;
    }

    trigger() {
        this.service.getChats().then(chats => {
            if (chats.length > 0) {
                chats.forEach(chat => {
                    this.service.duty(chat)
                        .then(
                            duty => {
                                if (duty.length > 0) {
                                    this.bot.telegram.sendMessage(chat.id, [`Дежурны${this.pt(duty, 'е', 'й')} на сегодня: `, ...duty].join(this.pt(duty, '\n', '')))
                                } else {
                                    this.bot.telegram.sendMessage(chat.id, 'Дежурных нет. Добавьте людей в список.')
                                }
                            },
                            (error) => {
                                console.log("send trigger", error);
                                this._sendMessageToOwner('Произошла ошибка, при рассылке тригера. ' + JSON.stringify(error, null, 2));
                            }
                        )
                });
            }
        }, (error) => {
            console.log("trigger", error);
            this._sendMessageToOwner('Произошла ошибка, при обработке тригера. ' + JSON.stringify(error, null, 2));
        })
    }

    getBot() {

        this.bot.use(commandParts());

        this.bot.catch((err, ctx) => {
            this._onError(ctx)(new ServiceError('В сервисе произошла ошибка.', err));
        })

        this.bot.start((ctx) => {
            this._chatExtractor(ctx).then(chat => {
                this.service.init(chat)
                    .then(
                        msg => this._replyMessage(ctx, msg),
                        this._onError(ctx)
                    )
            })
        });

        this.bot.help((ctx) => {
            const help = [
                "<b>Общие команды:</b>",
                "/duty - выбрать дежурных.",
                "/triggerOn - включить автоматическое назначение дежурных (будни в 09 МСК).",
                "/triggerOff - отключить автоматическое назначение дежурных.",
                "/reg - стать участником.",
                "/unreg - уйти из участников.",
                "/list - список участников.",
                "/reset - очистить участников.",
                "/help - очистить участников.",
                "",
                "<b>Управление:</b>",
                "/set 2 - выставляет количество дежурных.",
                "/add @employer[ @employerN] - добавить участников.",
                "/remove @employer[ @employerN] - удалить участников.",
                "",
                "",
                `<i>Версия:</i> <b>${this.functionContext.functionVersion}</b>`
            ].join('\n');

            this._replyMessage(ctx, help)
        });

        this.bot.command("triggerOn", (ctx) => {
            this._chatExtractor(ctx).then(chat => {
                this.service.triggerOn(chat)
                    .then(
                        () => this._replyMessage(ctx, "Автоназначение включено"),
                        this._onError(ctx)
                    )
            })
        });

        this.bot.command("triggerOff", (ctx) => {
            this._chatExtractor(ctx).then(chat => {
                this.service.triggerOff(chat)
                    .then(
                        () => this._replyMessage(ctx, "Автоназначение отключено"),
                        this._onError(ctx)
                    )
            })
        });

        this.bot.command("duty", (ctx) => {
            this._chatExtractor(ctx).then(chat => {
                this.service.duty(chat)
                    .then(
                        duty => {
                            if (duty.length > 0) {
                                this._replyMessage(ctx, [`Дежурны${this.pt(duty, 'е', 'й')} на сегодня: `, ...duty].join(this.pt(duty, '\n', '')))
                            } else {
                                this._replyMessage(ctx, 'Дежурных нет. Добавьте людей в список.')
                            }
                        },
                        this._onError(ctx)
                    )
            })
        });

        this.bot.command("reset", (ctx) => {
            this._chatExtractor(ctx).then(chat => {
                this.service.reset(chat)
                    .then(
                        msg => this._replyMessage(ctx, 'Дежурные и триггеры удалены, а настройки чата сброшены.'),
                        this._onError(ctx)
                    )
            })
        });

        this.bot.command("remove", (ctx) => {
            this._chatExtractor(ctx).then(chat => {
                if (ctx.state.command && ctx.state.command.splitArgs && ctx.state.command.splitArgs.length > 0) {

                    const deleteDutyPeople = ctx.state.command.splitArgs;

                    Promise.all(deleteDutyPeople.map(dutyUser => {
                        return this.service.unreg(chat, dutyUser[0] === '@' ? dutyUser.substring(1) : dutyUser)
                    })).then(
                        () => this._replyMessage(ctx, `Дежурны${this.pt(deleteDutyPeople, 'е', 'й')} удал${this.pt(deleteDutyPeople, 'е', 'ё')}н${this.pt(deleteDutyPeople, 'ы', '')}.`),
                        this._onError(ctx)
                    )

                } else {
                    this._onErrorInArg(ctx, '/remove @employer[ @employerN]');
                }

            })
        });

        this.bot.command("add", (ctx) => {
            this._chatExtractor(ctx).then(chat => {
                if (ctx.state.command && ctx.state.command.splitArgs && ctx.state.command.splitArgs.length > 0) {

                    const newDutyPeople = ctx.state.command.splitArgs;

                    Promise.all(newDutyPeople.map(dutyUser => {
                        return this.service.reg(chat, dutyUser[0] === '@' ? dutyUser.substring(1) : dutyUser)
                    })).then(
                        () => this._replyMessage(ctx, `Дежурны${this.pt(newDutyPeople, 'е', 'й')} добавлен${this.pt(newDutyPeople, 'ы', '')}.`),
                        this._onError(ctx)
                    )


                } else {
                    this._onErrorInArg(ctx, '/add @employer[, @employerN]');
                }

            })
        });

        this.bot.command("set", (ctx) => {
            this._chatExtractor(ctx).then(chat => {
                if (ctx.state.command && ctx.state.command.splitArgs && ctx.state.command.splitArgs.length > 0) {

                    var dutyCount = 0;
                    try {
                        dutyCount = parseInt(ctx.state.command.splitArgs[0], 10);
                    } catch (err) {

                    }

                    if (dutyCount > 0) {
                        this.service.setDutyCount(chat, dutyCount)
                            .then(
                                newDutycount => this._replyMessage(ctx, `Количество дежурных на день: ${newDutycount}.`),
                                this._onError(ctx)
                            )
                    } else {
                        this._onErrorInArg(ctx, '/set 2', 'Значение должно быть больше 0');
                    }

                } else {
                    this._onErrorInArg(ctx, '/set 2');
                }

            })
        });

        this.bot.command("clear", (ctx) => {
            this._chatExtractor(ctx).then(chat => {
                this.service.clear(chat)
                    .then(
                        msg => this._replyMessage(ctx, 'Данные о чате удалены из хранилища.'),
                        this._onError(ctx)
                    )

            })
        });

        this.bot.command("reg", (ctx) => {
            this._chatExtractor(ctx).then(chat => {
                this.service.reg(chat, ctx.from.username)
                    .then(
                        msg => this._replyMessage(ctx, msg),
                        this._onError(ctx)
                    )
            })
        });

        this.bot.command("unreg", (ctx) => {
            this._chatExtractor(ctx).then(chat => {
                this.service.unreg(chat, ctx.from.username)
                    .then(
                        msg => this._replyMessage(ctx, msg),
                        this._onError(ctx)
                    )
            })
        });

        this.bot.command("list", (ctx) => {
            this._chatExtractor(ctx).then(chat => {
                this.service.list(chat, ctx.from.username)
                    .then(
                        dutyUsers => {
                            if (dutyUsers.length > 0) {
                                const msg = [
                                    'Список дежурных:',
                                    dutyUsers.join(", "),
                                    `Всего ${dutyUsers.length}`
                                ].join('\n')

                                ctx.getChatMembersCount().then(memberCount => {
                                    this._replyMessage(ctx, `${msg} из ${memberCount - SELF_BOT}`);
                                }).catch(() => {
                                    this._replyMessage(ctx, msg);
                                })

                            } else {
                                this._replyMessage(ctx, 'Дежурных нет.');
                            }
                        },
                        this._onError(ctx)
                    )
            })
        });

        return this.bot;
    }

    _sendMessageToOwner(msg) {
        this.bot.telegram.sendMessage(this.ownerId, this._prepareMessage(msg), {
            parse_mode: 'HTML',
        });
    }

    _replyMessage(ctx, msg) {
        ctx.replyWithHTML(this._prepareMessage(msg))
    }

    _prepareMessage(msg) {
        if (msg.length > MAX_MESSAGE_SIZE) {
            return msg.slice(0, MAX_MESSAGE_SIZE) + '...'
        } else {
            return msg
        }
    }

    _onErrorInArg(ctx, example, msg = "") {
        this._onError(ctx)(new ServiceError(`Ошибка в аргументах. ${msg}. Ожидается: <code>${example}</code>`, new Error()));
    }

    _escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    _onError(ctx) {
        return (error) => {
            if (error instanceof ServiceError) {
                const id = nanoid();

                const { msg, err } = error;

                const errorMsg = [
                    `<b>ID:</b> ${id}`,
                    '',
                    `<b>Сообщение в чат:</b> ${msg}`,
                    '',
                    `<b>Ошибка:</b> ${err.message}`,
                    '',
                    "<b>Stack:</b>",
                    this._escapeHtml(err.stack)
                ]

                console.error(JSON.stringify(errorMsg.filter(el => el != "")));

                this._sendMessageToOwner(errorMsg.join('\n'));
                this._replyMessage(ctx, `${msg}\n\n<b>id:</b> <code>${id}</code>`);

            } else {
                this._onError(ctx)(new ServiceError('В сервисе произошла ошибка.', error));
            }
        }
    }

    _chatExtractor(ctx) {
        return new Promise((resolve, reject) => {
            ctx.getChat().then(chat => {
                resolve(chat)
            }).catch(error => {
                reject(new ServiceError("Ошибка при получении информации о чате.", error));
            })
        })
    }
}

module.exports = Controller
