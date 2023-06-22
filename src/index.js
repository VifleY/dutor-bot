const S3 = require('aws-sdk/clients/s3');

const Service = require('./service');
const Controller = require('./controller');

module.exports.handler = async function (event, functionContext) {
    const s3storage = new S3({ endpoint: 'storage.yandexcloud.net' });
    const service = new Service(s3storage);
    const controller = new Controller(service, process.env.BOT_TOKEN, process.env.OWNER_ID, functionContext);

    if (event.messages) {
        controller.trigger();
    } else {
        try {
            const message = JSON.parse(event.body);
            await controller.getBot().handleUpdate(message)
        } catch (error) {
            console.error(error.message);
        }
    }

    return {
        statusCode: 200,
        body: ''
    };
};
