const express = require("express");
const { asyncHandler } = require("../utils/http");
const { authRequiredAllowQuery } = require("../middlewares/auth");
const { streamStoredFile } = require("../utils/storage");

const uploadsRoutes = express.Router();
uploadsRoutes.use(authRequiredAllowQuery);
uploadsRoutes.use(
  asyncHandler(async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const remainder = String(req.path || "").replace(/^\/+/, "");
    await streamStoredFile(res, remainder);
  })
);

module.exports = { uploadsRoutes };
