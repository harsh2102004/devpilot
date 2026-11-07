import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { isTokenRevoked } from '../services/tokenRevocation.service.js';

const auth = async function (req, res, next) {
    const authHeader = req.header('Authorization');

    if (!authHeader) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Token format is invalid, authorization denied' });
        }

        // Check if token has been revoked or session terminated (Sub-Phase 10B)
        const revoked = await isTokenRevoked(token);
        if (revoked) {
            return res.status(401).json({ message: 'Token has been revoked or session terminated' });
        }

        const decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET);
        req.user = decoded.user || decoded;
        req.token = token; // Attach token for downstream logout revocation

        // Normalize: JWT payload uses `id`, but controllers expect `_id`
        if (req.user.id && !req.user._id) {
            req.user._id = req.user.id;
        }
        next();
    } catch (err) {
        res.status(401).json({ message: 'Token is not valid' });
    }
};

export default auth;
export { auth };
