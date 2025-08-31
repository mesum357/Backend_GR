# Tourist Ride-Sharing Backend API

A comprehensive Express.js backend with Passport.js authentication for the Tourist Ride-Sharing mobile application.

## Features

- **Authentication**: JWT and Local strategy with Passport.js
- **User Management**: Registration, login, profile management
- **Ride Management**: Book, accept, start, complete, and cancel rides
- **Driver Operations**: Driver-specific routes and statistics
- **Geolocation**: Location-based queries and nearby driver search
- **Wallet System**: Balance management and transactions
- **Rating System**: User ratings and reviews

## Tech Stack

- **Node.js** with **Express.js**
- **MongoDB** with **Mongoose** ODM
- **Passport.js** for authentication
- **JWT** for token-based authentication
- **bcryptjs** for password hashing
- **CORS** for cross-origin requests

## Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   Create a `.env` file in the root directory:
   ```env
   PORT=5000
   NODE_ENV=development
   MONGODB_URI=mongodb://localhost:27017/tourist-app
   JWT_SECRET=your-super-secret-jwt-key
   SESSION_SECRET=your-super-secret-session-key
   ```

3. **Start MongoDB**:
   Make sure MongoDB is running on your system.

4. **Run the server**:
   ```bash
   # Development mode with auto-restart
   npm run dev
   
   # Production mode
   npm start
   ```

## API Endpoints

### Authentication (`/api/auth`)

- `POST /register` - Register new user
- `POST /login` - User login
- `POST /logout` - User logout
- `GET /profile` - Get current user profile
- `PUT /profile` - Update user profile
- `PUT /change-password` - Change password
- `POST /forgot-password` - Request password reset
- `POST /reset-password` - Reset password

### Users (`/api/users`)

- `GET /` - Get all users (admin)
- `GET /:userId` - Get user by ID
- `PUT /location` - Update user location
- `PUT /online-status` - Toggle online status
- `GET /nearby/drivers` - Get nearby drivers
- `PUT /wallet` - Update wallet balance
- `GET /stats/summary` - Get user statistics

### Rides (`/api/rides`)

- `POST /book` - Book a new ride
- `GET /available` - Get available rides (drivers)
- `PUT /:rideId/accept` - Accept a ride (driver)
- `PUT /:rideId/start` - Start a ride
- `PUT /:rideId/complete` - Complete a ride
- `PUT /:rideId/cancel` - Cancel a ride
- `POST /:rideId/rate` - Rate a ride
- `GET /history` - Get ride history
- `GET /:rideId` - Get ride details

### Drivers (`/api/drivers`)

- `GET /stats` - Get driver statistics
- `GET /current-ride` - Get current ride
- `GET /ride-history` - Get ride history
- `PUT /earnings` - Update earnings
- `GET /schedule` - Get schedule
- `PUT /schedule` - Update schedule
- `GET /performance` - Get performance metrics

## Authentication

The API uses JWT tokens for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Database Models

### User Model
- Basic info (name, email, phone)
- User type (rider/driver)
- Location (geospatial)
- Wallet balance
- Rating and statistics
- Preferences

### Ride Model
- Rider and driver references
- Pickup and destination locations
- Status tracking
- Pricing information
- Rating system
- Timestamps

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Error message"
}
```

## Development

### Running in Development Mode
```bash
npm run dev
```

### Testing the API
You can test the API using tools like:
- Postman
- Insomnia
- curl commands

### Example API Calls

**Register a new user**:
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "firstName": "John",
    "lastName": "Doe",
    "phone": "+1234567890",
    "userType": "rider"
  }'
```

**Login**:
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

## Security Features

- Password hashing with bcryptjs
- JWT token authentication
- CORS protection
- Input validation
- Rate limiting (can be added)
- Helmet.js (can be added for additional security)

## Production Deployment

1. Set `NODE_ENV=production`
2. Use strong JWT and session secrets
3. Enable HTTPS
4. Set up proper CORS origins
5. Use environment variables for sensitive data
6. Set up MongoDB Atlas or production MongoDB instance

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the ISC License.
