const express = require('express');
const Vehicle = require('../models/Vehicle');

const router = express.Router();

// List vehicles (used by driver signup)
router.get('/', async (req, res) => {
  try {
    const activeOnly = String(req.query.activeOnly || 'true') !== 'false';
    const query = activeOnly ? { isActive: true } : {};
    const vehicles = await Vehicle.find(query).sort({ name: 1 }).lean();
    return res.json({ vehicles });
  } catch (err) {
    console.error('Error listing vehicles:', err);
    return res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});

// Create vehicle (used from Admin panel)
router.post('/', async (req, res) => {
  try {
    const { name, rideType, isActive } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Vehicle name is required' });
    }
    if (!rideType || typeof rideType !== 'string') {
      return res.status(400).json({ error: 'Vehicle rideType is required' });
    }

    const vehicle = await Vehicle.create({
      name: name.trim(),
      rideType,
      isActive: typeof isActive === 'boolean' ? isActive : true,
    });

    return res.status(201).json({ message: 'Vehicle created', vehicle });
  } catch (err) {
    console.error('Error creating vehicle:', err);
    if (err && err.code === 11000) {
      return res.status(400).json({ error: 'Vehicle with this name already exists' });
    }
    return res.status(500).json({ error: 'Failed to create vehicle' });
  }
});

// Update vehicle
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};
    const { name, rideType, isActive } = req.body || {};

    if (typeof name === 'string' && name.trim()) updates.name = name.trim();
    if (typeof rideType === 'string' && rideType.trim()) updates.rideType = rideType.trim();
    if (typeof isActive === 'boolean') updates.isActive = isActive;

    const vehicle = await Vehicle.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    return res.json({ message: 'Vehicle updated', vehicle });
  } catch (err) {
    console.error('Error updating vehicle:', err);
    return res.status(500).json({ error: 'Failed to update vehicle' });
  }
});

// Delete vehicle
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Vehicle.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: 'Vehicle not found' });
    return res.json({ message: 'Vehicle deleted' });
  } catch (err) {
    console.error('Error deleting vehicle:', err);
    return res.status(500).json({ error: 'Failed to delete vehicle' });
  }
});

module.exports = router;

