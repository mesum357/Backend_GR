const Driver = require('./models/Driver');
const RideRequest = require('./models/RideRequest');
const {
  normalizeRideTypeKey,
  canonicalRideRequestVehicleType,
  rideTypesMatch,
} = require('./utils/rideFarePricing');

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function testCanonicalAliases() {
  assertEqual(normalizeRideTypeKey('Moto'), 'moto', 'catalog Moto');
  assertEqual(normalizeRideTypeKey('motorcycle'), 'moto', 'motorcycle');
  assertEqual(normalizeRideTypeKey('bike'), 'moto', 'bike');
  assertEqual(normalizeRideTypeKey('Ride Mini'), 'ride_mini', 'catalog Ride Mini');
  assertEqual(normalizeRideTypeKey('car'), 'ride_mini', 'car');
  assertEqual(normalizeRideTypeKey('Ride With AC'), 'ride_ac', 'catalog Ride With AC');
  assertEqual(normalizeRideTypeKey('Premium'), 'premium', 'catalog Premium');
  assertEqual(canonicalRideRequestVehicleType('moto'), 'moto', 'persist moto');
  assertEqual(canonicalRideRequestVehicleType('Moto'), 'moto', 'persist catalog Moto');
  assertEqual(canonicalRideRequestVehicleType('any'), 'any', 'persist any');
  assertEqual(canonicalRideRequestVehicleType(''), 'any', 'persist empty as any');

  if (!rideTypesMatch('moto', 'Moto')) throw new Error('moto request should match Moto driver');
  if (!rideTypesMatch('moto', 'motorcycle')) throw new Error('moto request should match motorcycle driver');
  if (rideTypesMatch('moto', 'Ride Mini')) throw new Error('moto request must not match Ride Mini driver');
  if (rideTypesMatch('ride_mini', 'Moto')) throw new Error('ride_mini request must not match Moto driver');
  if (!rideTypesMatch('ride_mini', 'car')) throw new Error('ride_mini request should match car driver');
  if (!rideTypesMatch('any', 'Moto')) throw new Error('any should match moto driver');
}

async function testDriverRideTypeFiltering() {
  const fn = Driver.schema.statics.findNearbyDrivers;

  const fakeNearbyDrivers = [
    { vehicleInfo: { rideType: 'moto' } },
    { vehicleInfo: { rideType: 'ride_mini' } },
    { vehicleInfo: { vehicleType: 'motorcycle' } },
    { vehicleInfo: { vehicleType: 'car' } },
    { vehicleInfo: { rideType: 'Moto' } },
    { vehicleInfo: { rideType: 'Ride Mini' } },
  ];

  const fakeCtx = {
    findNearbyDriversByH3: async () => [],
    find: () => ({
      populate: () => ({
        limit: async () => fakeNearbyDrivers,
      }),
    }),
  };

  const motoMatches = await fn.call(fakeCtx, 35.92, 74.31, 5, 'moto');
  const miniMatches = await fn.call(fakeCtx, 35.92, 74.31, 5, 'ride_mini');
  const anyMatches = await fn.call(fakeCtx, 35.92, 74.31, 5, 'any');

  if (motoMatches.length !== 3) {
    throw new Error(`Expected 3 moto matches, got ${motoMatches.length}`);
  }
  if (miniMatches.length !== 3) {
    throw new Error(`Expected 3 ride_mini matches, got ${miniMatches.length}`);
  }
  if (anyMatches.length !== 6) {
    throw new Error(`Expected 6 any matches, got ${anyMatches.length}`);
  }
}

async function testRideRequestForwardsVehicleType() {
  const original = Driver.findNearbyDrivers;
  let captured = null;

  Driver.findNearbyDrivers = async (lat, lng, maxDistance, requestedVehicleType) => {
    captured = { lat, lng, maxDistance, requestedVehicleType };
    return [];
  };

  try {
    const fakeRequestDoc = {
      pickupLocation: { latitude: 35.92, longitude: 74.31 },
      vehicleType: 'moto',
    };

    await RideRequest.schema.methods.findNearbyDrivers.call(fakeRequestDoc, 7);

    if (!captured) {
      throw new Error('Driver.findNearbyDrivers was not called');
    }
    if (captured.requestedVehicleType !== 'moto') {
      throw new Error(
        `Expected requestedVehicleType "moto", got "${captured.requestedVehicleType}"`
      );
    }
    if (captured.maxDistance !== 7) {
      throw new Error(`Expected maxDistance 7, got ${captured.maxDistance}`);
    }
  } finally {
    Driver.findNearbyDrivers = original;
  }
}

async function main() {
  testCanonicalAliases();
  await testDriverRideTypeFiltering();
  await testRideRequestForwardsVehicleType();

  console.log('PASS: catalog aliases Moto/Ride Mini canonicalize correctly');
  console.log('PASS: moto drivers only match moto requests');
  console.log('PASS: ride_mini drivers only match ride_mini requests');
  console.log('PASS: RideRequest forwards vehicleType into driver lookup');
}

main().catch((err) => {
  console.error('FAIL:', err.message || err);
  process.exit(1);
});
