import jwt from 'jsonwebtoken';

const auth = function (req, res, next) {
    const authHeader = req.header('Authorization');

    if (!authHeader) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Token format is invalid, authorization denied' });
        }

        const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET || 'fallback_secret');
        req.user = decoded.user || decoded;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Token is not valid' });
    }
};

export default auth;
export { auth };
