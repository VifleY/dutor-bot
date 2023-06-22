class ServiceError {
    constructor(msg, err) {
        this.msg = msg;
        this.err = err;
    }
}

module.exports.ServiceError = ServiceError;
