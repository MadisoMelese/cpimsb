'use strict';

const usersService = require('./users.service');

async function createUser(req, res, next) {
  try {
    const user = await usersService.createUser(req.body);
    res.status(201).json({ success: true, data: user });
  } catch (err) { next(err); }
}

async function listUsers(req, res, next) {
  try {
    const result = await usersService.listUsers(req.query);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}

async function getUser(req, res, next) {
  try {
    const user = await usersService.getUserById(req.params.id);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

async function updateUser(req, res, next) {
  try {
    const user = await usersService.updateUser(req.params.id, req.body);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

async function changePassword(req, res, next) {
  try {
    await usersService.changePassword(req.params.id, req.body.password);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) { next(err); }
}

module.exports = { createUser, listUsers, getUser, updateUser, changePassword };
