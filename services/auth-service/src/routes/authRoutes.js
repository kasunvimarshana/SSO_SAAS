'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const controller = require('../controllers/authController');

const router = Router();

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const registerValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters.'),
  body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('A valid email address is required.'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters.')
    .matches(/\d/)
    .withMessage('Password must contain at least one number.'),
  body('role')
    .optional()
    .isIn(['user', 'admin'])
    .withMessage('Role must be "user" or "admin".'),
];

const loginValidation = [
  body('email').trim().isEmail().normalizeEmail().withMessage('A valid email address is required.'),
  body('password').notEmpty().withMessage('Password is required.'),
];

const refreshValidation = [
  body('refreshToken').notEmpty().withMessage('refreshToken is required.'),
];

const logoutValidation = [
  body('refreshToken').notEmpty().withMessage('refreshToken is required.'),
];

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get('/health', controller.health);

router.post('/register', registerValidation, controller.register);
router.post('/login', loginValidation, controller.login);
router.post('/logout', logoutValidation, controller.logout);
router.post('/refresh', refreshValidation, controller.refresh);
router.get('/validate', controller.validate);

module.exports = router;
