'use strict';

/**
 * Builds Prisma pagination args from page/limit query params.
 */
function paginate(page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  return { skip, take: limit };
}

/**
 * Wraps a paginated result with metadata.
 */
function paginatedResponse(data, total, page, limit) {
  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPrevPage: page > 1,
    },
  };
}

module.exports = { paginate, paginatedResponse };
