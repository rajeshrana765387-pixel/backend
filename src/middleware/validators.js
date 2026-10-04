const { body, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

const nameValidator = body('name')
  .isLength({ min: 20, max: 60 })
  .withMessage('Name must be between 20 and 60 characters')
  .trim();

const emailValidator = body('email')
  .isEmail()
  .withMessage('Must be a valid email address')
  .normalizeEmail();

const passwordValidator = body('password')
  .isLength({ min: 8, max: 16 })
  .withMessage('Password must be between 8 and 16 characters')
  .matches(/[A-Z]/)
  .withMessage('Password must contain at least one uppercase letter')
  .matches(/[!@#$%^&*(),.?":{}|<>]/)
  .withMessage('Password must contain at least one special character');

const addressValidator = body('address')
  .optional()
  .isLength({ max: 400 })
  .withMessage('Address must not exceed 400 characters')
  .trim();

const registerValidators = [
  nameValidator,
  emailValidator,
  passwordValidator,
  addressValidator,
  handleValidationErrors,
];

const loginValidators = [
  emailValidator,
  body('password').notEmpty().withMessage('Password is required'),
  handleValidationErrors,
];

const updatePasswordValidators = [
  passwordValidator,
  handleValidationErrors,
];

const storeValidators = [
  nameValidator,
  emailValidator,
  addressValidator,
  handleValidationErrors,
];

const ratingValidator = [
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be an integer between 1 and 5'),
  handleValidationErrors,
];

module.exports = {
  registerValidators,
  loginValidators,
  updatePasswordValidators,
  storeValidators,
  ratingValidator,
  handleValidationErrors,
};
