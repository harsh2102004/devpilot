import asyncHandler from '../utils/asyncHandler.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';




const registerUser = asyncHandler(async (req, res) => {
    // get user details from frontend
    // validation - not empty
    // check if user already exists: username, email
    //avatar 
    // create user object - create entry in db
    // remove password and refresh token field from response
    // check for user creation
    // return res


    const { fullName, email, username, password } = req.body
    if (!username || !email || !password || !fullName) {
        return res.status(400).json({ message: "All fields are required" })
    }

    const existedUser = await User.findOne({
        $or: [{ username }, { email }]
    })
    if (existedUser) { throw new ApiError(400, "user already exists") }
    const avatarLocalPath = req.files?.avatar[0].path;
    if (!avatarLocalPath) {
        throw new ApiError(400, "avatar is required")
    }
    const user = await User.create({
        fullName,
        username: username.toLowerCase(),
        avatar: avatarLocalPath,
        email,
        password
    })
    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )
    if (!createdUser) {
        throw new ApiError(500, "user not created please try again")
    }
    return res.status(201).json(new ApiResponse(200, createdUser, "user created successfully"));


})

export { registerUser };
export default registerUser;