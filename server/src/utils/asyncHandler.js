const asyncHandler = (requestHandler) => {
    return (req, res, next) => {
        return Promise.resolve(requestHandler(req, res, next)).catch((err) => next ? next(err) : Promise.reject(err));
    };
};

export { asyncHandler };
export default asyncHandler;
