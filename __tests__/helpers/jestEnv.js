// Runs before every Jest test file. Tests must never reach the network:
// lib/users/breachedPassword.js is switched off here, and its own tests turn
// it back on with a mocked fetch.
process.env.BREACHED_PASSWORD_CHECK = "off";
