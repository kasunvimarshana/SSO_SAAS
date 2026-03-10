const { Op } = require('sequelize');
const { validationResult } = require('express-validator');
const User = require('../models/User');

function paginate(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(query.limit, 10) || 10, 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function buildUserResponse(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    is_active: user.is_active,
    profile: user.profile || {},
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

// GET /api/users/health
async function healthCheck(req, res) {
  res.json({ success: true, service: 'user-service', status: 'healthy', timestamp: new Date().toISOString() });
}

// GET /api/users/me
async function getCurrentUser(req, res) {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user || !user.is_active) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, data: buildUserResponse(user) });
  } catch (error) {
    console.error('getCurrentUser error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// PUT /api/users/me
async function updateCurrentUser(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  try {
    const user = await User.findByPk(req.user.id);
    if (!user || !user.is_active) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { name, profile } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (profile !== undefined) {
      updates.profile = { ...(user.profile || {}), ...profile };
    }

    await user.update(updates);
    res.json({ success: true, data: buildUserResponse(user) });
  } catch (error) {
    console.error('updateCurrentUser error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// GET /api/users  (admin only)
async function getAllUsers(req, res) {
  try {
    const { page, limit, offset } = paginate(req.query);
    const { search, role, is_active } = req.query;

    const where = {};

    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (role && ['admin', 'user'].includes(role)) {
      where.role = role;
    }

    if (is_active !== undefined) {
      where.is_active = is_active === 'true';
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC']],
    });

    res.json({
      success: true,
      data: rows.map(buildUserResponse),
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error('getAllUsers error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// GET /api/users/:id
async function getUserById(req, res) {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isAdmin = req.user.role === 'admin';
    const isSelf = req.user.id === user.id;

    if (!isAdmin && !isSelf) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    res.json({ success: true, data: buildUserResponse(user) });
  } catch (error) {
    console.error('getUserById error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// POST /api/users  (admin only)
async function createUser(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  try {
    const { name, email, role, profile } = req.body;

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already in use' });
    }

    const user = await User.create({
      name,
      email,
      role: role || 'user',
      is_active: true,
      profile: profile || {},
    });

    res.status(201).json({ success: true, data: buildUserResponse(user) });
  } catch (error) {
    console.error('createUser error:', error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'Email already in use' });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// PUT /api/users/:id
async function updateUser(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isAdmin = req.user.role === 'admin';
    const isSelf = req.user.id === user.id;

    if (!isAdmin && !isSelf) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { name, profile, role, is_active } = req.body;
    const updates = {};

    if (name !== undefined) updates.name = name;
    if (profile !== undefined) updates.profile = { ...(user.profile || {}), ...profile };
    if (isAdmin) {
      if (role !== undefined && ['admin', 'user'].includes(role)) updates.role = role;
      if (is_active !== undefined) updates.is_active = is_active;
    }

    await user.update(updates);
    res.json({ success: true, data: buildUserResponse(user) });
  } catch (error) {
    console.error('updateUser error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// DELETE /api/users/:id  (admin only, soft delete)
async function deleteUser(req, res) {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot deactivate your own account' });
    }

    await user.update({ is_active: false });
    res.json({ success: true, message: 'User deactivated successfully' });
  } catch (error) {
    console.error('deleteUser error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = {
  healthCheck,
  getCurrentUser,
  updateCurrentUser,
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
};
