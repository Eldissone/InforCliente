function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function zodErrorToResponse(err) {
  return {
    error: "VALIDATION_ERROR",
    details: err.issues?.map((i) => ({
      path: i.path?.join("."),
      message: i.message,
    })),
  };
}

module.exports = { asyncHandler, zodErrorToResponse };

