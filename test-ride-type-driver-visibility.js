const Driver = require('./models/Driver');
const RideRequest = require('./models/RideRequest');

async function testDriverRideTypeFiltering() {
  const fn = Driver.schema.statics.findNearbyDrivers;

  const fakeNearbyDrivers = [
    { vehicleInfo: { rideType: 'moto' } },
    { vehicleInfo: { rideType: 'ride_mini' } },
    { vehicleInfo: { vehicleType: 'motorcycle' } },
    { vehicleInfo: { vehicleType: 'car' } },
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

  if (motoMatches.length !== 2) {
    throw new Error(`Expected 2 moto matches, got ${motoMatches.length}`);
  }
  if (miniMatches.length !== 2) {
    throw new Error(`Expected 2 ride_mini matches, got ${miniMatches.length}`);
  }
  if (anyMatches.length !== 4) {
    throw new Error(`Expected 4 any matches, got ${anyMatches.length}`);
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
  await testDriverRideTypeFiltering();
  await testRideRequestForwardsVehicleType();

  console.log('PASS: moto drivers only match moto requests');
  console.log('PASS: ride_mini drivers only match ride_mini requests');
  console.log('PASS: RideRequest forwards vehicleType into driver lookup');
}

main().catch((err) => {
  console.error('FAIL:', err.message || err);
  process.exit(1);
});
