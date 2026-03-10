const { Router } = require('express');
const { body, param } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const {
  healthCheck,
  getCurrentUser,
  updateCurrentUser,
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
} = require('../controllers/userController');

const router = Router();

const uuidParam = param('id').isUUID(4).withMessage('Invalid user ID format');

const nameBody = body('name')
  .optional()
  .trim()
  .isLength({ min: 1, max: 255 })
  .withMessage('Name must be between 1 and 255 characters');

const emailBody = body('email')
  .notEmpty().withMessage('Email is required')
  .isEmail().withMessage('Invalid email address')
  .normalizeEmail();

const profileBody = body('profile')
  .optional()
  .isObject()
  .withMessage('Profile must be an object');

const profileBioBody = body('profile.bio')
  .optional()
  .isString()
  .isLength({ max: 1000 })
  .withMessage('Bio must be a string with at most 1000 characters');

const profileAvatarBody = body('profile.avatar_url')
  .optional()
  .isURL()
  .withMessage('avatar_url must be a valid URL');

const profilePhoneBody = body('profile.phone')
  .optional()
  .isMobilePhone()
  .withMessage('phone must be a valid phone number');

// Public
router.get('/health', healthCheck);

// Authenticated routes — /me must be defined before /:id to avoid "me" being treated as a UUID
router.get('/me', authenticate, getCurrentUser);
router.put('/me', authenticate, [nameBody, profileBody, profileBioBody, profileAvatarBody, profilePhoneBody], updateCurrentUser);

// Admin-only routes
router.get('/', authenticate, authorize('admin'), getAllUsers);
router.post(
  '/',
  authenticate,
  authorize('admin'),
  [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 255 }),
    emailBody,
    body('role').optional().isIn(['admin', 'user']).withMessage('Role must be admin or user'),
    profileBody,
    profileBioBody,
    profileAvatarBody,
    profilePhoneBody,
  ],
  createUser
);
router.delete('/:id', authenticate, authorize('admin'), [uuidParam], deleteUser);

// Authenticated routes (admin or self)
router.get('/:id', authenticate, [uuidParam], getUserById);
router.put(
  '/:id',
  authenticate,
  [
    uuidParam,
    nameBody,
    body('role').optional().isIn(['admin', 'user']).withMessage('Role must be admin or user'),
    body('is_active').optional().isBoolean().withMessage('is_active must be a boolean'),
    profileBody,
    profileBioBody,
    profileAvatarBody,
    profilePhoneBody,
  ],
  updateUser
);

module.exports = router;
