# CaneMap - Intelligent Sugarcane Farm Management System

A comprehensive web-based platform for managing sugarcane fields in Ormoc City, Philippines. CaneMap streamlines field operations, automates crop cycle management, and facilitates communication between farmers, workers, drivers, and the Sugar Regulatory Administration (SRA).

**Live Demo:** [canemap-system.web.app](https://canemap-system.web.app)

---

## Overview

CaneMap helps sugarcane farmers manage their operations from planting to harvest. The system provides real-time field monitoring, automated task scheduling based on crop growth stages, and seamless coordination between all stakeholders in the sugarcane farming ecosystem.

### Key Benefits

- **Automated Task Management** - Generates scientifically-timed tasks based on Days After Planting (DAP)
- **Growth Tracking** - Monitors crop development from germination to harvest
- **Real-time Collaboration** - Workers, drivers, and landowners stay synchronized
- **Compliance Ready** - Built-in SRA reporting and field documentation
- **Mobile Responsive** - Works on any device, anywhere in the field

---

## Features

### For Handlers (Landowners/Farmers)

**Field Management**

- Register fields with soil type, irrigation method, terrain, and location data
- Interactive map showing all your fields across Ormoc City (121 barangays)
- Field status tracking (pending, reviewed, active, harvested)

**Automated Task Workflow**

- Auto-generates 9 tasks after planting completion:
  - Basal Fertilizer (0-30 DAP)
  - Gap Filling (15-30 DAP)
  - Main Fertilization (45-60 DAP) - Critical window
  - Weeding & Cultivation (30-90 DAP)
  - Pest Monitoring (60-180 DAP)
  - Optional Top Dressing (90-150 DAP)
  - Pre-Harvest Irrigation (255-351 DAP)
  - Harvest Preparation (335-358 DAP)
  - Harvesting (355-375 DAP)

**Smart Task Recommendations**

- DAP-aware suggestions when creating tasks
- Color-coded urgency levels (critical, high, medium, low)
- Prevents illogical tasks (e.g., harvesting before planting)

**Dashboard Warnings**

- Real-time alerts for overdue critical tasks
- Notifications when approaching important windows
- Main fertilization tracking (most critical 45-60 DAP window)

**Team Management**

- Assign tasks to workers and drivers
- Approve worker join requests
- Rent drivers for equipment operations
- Track team productivity metrics

**Analytics & Reports**

- Task completion rates
- Growth stage distribution charts
- Variety breakdown across fields
- Submit reports to SRA for compliance

### For Workers

**Task Logging**

- Record completed activities with photo proof
- Upload selfies and field photos for verification
- Flexible logging with minimal validation for emergency work
- View assigned tasks and field locations

**Field Access**

- Join available fields by requesting access
- View approved field details and maps
- Track work history across multiple fields

### For Drivers

**Rental System**

- Apply for driver badge with license and vehicle verification
- Accept rental requests from handlers
- View assigned fields and tasks
- Track rental history and earnings

**Badge Management**

- Upload driver photo, license (front/back), vehicle OR
- Admin review and approval process
- Badge status tracking

### For SRA Officers

**Field Review**

- Review field registrations and documents
- Approve or reject field applications
- View all field data and crop progress

**Report Management**

- Review submitted handler reports:
  - Crop planting records
  - Growth updates
  - Harvest schedules
  - Fertilizer usage
  - Land titles
  - Barangay certifications
  - Production costs
- Approve, reject, or request revisions
- Provide feedback to handlers

### For System Administrators

**User Management**

- Track all registered users by role
- Monitor failed login attempts (security)
- Review and approve driver badge requests

**System Monitoring**

- View system-wide statistics
- Manage security incidents
- Configure system settings

---

## Technology Stack

### Frontend

- **HTML5/CSS3** - Semantic markup and styling
- **Tailwind CSS** - Utility-first styling with custom CaneMap theme
- **JavaScript (ES6+)** - Modern async/await patterns
- **Leaflet.js** - Interactive maps with OpenStreetMap
- **Chart.js** - Analytics visualizations
- **Font Awesome** - Icon library

### Backend

- **Firebase Authentication** - User management and sessions
- **Cloud Firestore** - Real-time NoSQL database
- **Firebase Storage** - File uploads (photos, documents)
- **Firebase Functions** - Serverless cloud functions
  - Daily harvest notification cron (8 AM Manila time)
  - Email verification handler
  - SRA account creation

### Infrastructure

- **Firebase Hosting** - Static site hosting with CDN
- **Firebase Security Rules** - Database and storage access control
- **Git** - Version control
- **GitHub** - Code repository

---

## Project Structure

```
CaneMap/
├── public/
│   ├── backend/           # JavaScript modules
│   │   ├── Common/        # Shared utilities (auth, notifications, config)
│   │   ├── Handler/       # Landowner features (fields, tasks, workers)
│   │   ├── Worker/        # Worker features (task logging, field joining)
│   │   ├── Driver/        # Driver features (rental, badge)
│   │   ├── SRA/           # SRA features (reviews, reports)
│   │   └── System_Admin/  # Admin features (users, security)
│   ├── frontend/          # HTML pages (organized by role)
│   │   ├── Common/        # Landing, login, signup, lobby
│   │   ├── Handler/       # Field registration, dashboard
│   │   ├── Worker/        # Task logging, field joining
│   │   ├── Driver/        # Driver dashboard, badge application
│   │   ├── SRA/           # SRA dashboard, field reviews
│   │   └── System_Admin/  # Admin dashboard
│   └── css/               # Compiled Tailwind styles
├── functions/             # Firebase Cloud Functions
│   ├── index.js           # Function definitions
│   └── package.json       # Node dependencies
├── firestore.rules        # Database security rules
├── firestore.indexes.json # Database indexes
├── storage.rules          # File upload security
├── firebase.json          # Firebase project config
└── tailwind.config.js     # Tailwind configuration
```

---

## Getting Started

### Prerequisites

- **Node.js** 20+ (for Firebase tools and Tailwind)
- **Firebase CLI** - `npm install -g firebase-tools`
- **Modern browser** (Chrome, Firefox, Safari, Edge)
- **Firebase project** with these services enabled:
  - Authentication (Email/Password)
  - Cloud Firestore
  - Cloud Storage
  - Cloud Functions
  - Hosting

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/CaneMap.git
   cd CaneMap
   ```

2. **Install dependencies**

   ```bash
   npm install
   cd functions && npm install && cd ..
   ```

3. **Configure Firebase**

   Update `public/backend/Common/firebase-config.js` with your Firebase project credentials:

   ```javascript
   const firebaseConfig = {
     apiKey: "your-api-key",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project-id",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "your-sender-id",
     appId: "your-app-id",
   };
   ```

4. **Deploy Firestore rules and indexes**

   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```

5. **Deploy Storage rules**

   ```bash
   firebase deploy --only storage
   ```

6. **Deploy Cloud Functions**

   ```bash
   firebase deploy --only functions
   ```

7. **Run locally** (optional)

   ```bash
   firebase emulators:start
   ```

   Visit `http://localhost:5000`

8. **Deploy to production**
   ```bash
   firebase deploy
   ```

### Build Tailwind CSS (Development)

If you modify Tailwind styles:

```bash
npm run build:css
# or watch mode:
npx tailwindcss -i ./public/css/input.css -o ./public/css/output.css --watch
```

---

## User Roles & Permissions

| Role             | Permissions                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| **Farmer**       | Register fields, submit reports                                        |
| **Handler**      | Manage fields, create tasks, hire workers/drivers, view analytics      |
| **Worker**       | Join fields, log task completion, upload proof photos                  |
| **Driver**       | Accept rentals, view assigned tasks, manage badge                      |
| **SRA**          | Review field registrations, approve/reject reports, monitor compliance |
| **System Admin** | Manage users, review driver badges, monitor security                   |

---

## Key Systems

### 1. Growth Tracking System

Automatically calculates Days After Planting (DAP) and determines growth stage:

- **Germination** (0-45 DAP)
- **Tillering** (45-100 DAP)
- **Grand Growth** (100-240 DAP)
- **Maturation** (240-300 DAP)
- **Ripening** (300-330 DAP)
- **Harvest-ready** (330+ DAP)

Variety-specific harvest dates:

- Phil 8013: 330 days
- Phil 75-514: 365 days
- VMC 02-1433: 365 days
- And 8 more varieties

### 2. Task Automation System

After marking a field as "Planting Complete", the system:

1. Calculates expected harvest date based on variety
2. Generates 9 scientifically-timed tasks with proper DAP windows
3. Assigns priorities (low, medium, high, critical)
4. Creates deadline dates optimized for each task
5. Adds detailed descriptions and agricultural notes

### 3. Notification System

Real-time notifications for:

- Field registration approval
- Task assignments
- Report submission status
- Driver rental requests
- Badge approval/rejection
- Harvest window alerts (daily cron at 8 AM)

Supports:

- Personal notifications (userId-based)
- Role-based broadcasts (all SRA, all admins, etc.)
- Unread count tracking
- Click-to-navigate functionality

### 4. Security System

**Authentication**

- Email verification required
- Password reset via email
- Session management with auto-refresh
- Failed login tracking (both registered users and unknown emails)

**Authorization**

- Role-based access control
- Field-level permissions
- Task ownership validation
- Document access restrictions

**Firestore Rules**

- User data isolation
- Field ownership checks
- Worker approval verification
- Admin-only operations

---

## Database Schema

### Key Collections

**users**

```javascript
{
  uid: string,
  email: string,
  full_name: string,
  role: "farmer" | "handler" | "worker" | "driver" | "sra" | "admin" | "system_admin",
  contact_number: string,
  address: string,
  emailVerified: boolean,
  status: "verified" | "pending",
  createdAt: timestamp
}
```

**fields**

```javascript
{
  id: string,
  field_name: string,
  userId: string,
  barangay: string,
  municipality: "Ormoc City",
  area: number,
  latitude: number,
  longitude: number,
  variety: string,
  soilType: string,
  irrigationMethod: string,
  fieldTerrain: string,
  previousCrop: string,
  plantingDate: timestamp,
  expectedHarvestDate: timestamp,
  currentGrowthStage: string,
  status: "pending" | "reviewed" | "active" | "harvested",
  createdAt: timestamp
}
```

**tasks**

```javascript
{
  id: string,
  fieldId: string,
  handlerId: string,
  title: string,
  taskType: string,
  description: string,
  deadline: timestamp,
  dapWindow: string,
  growthStage: string,
  priority: "low" | "medium" | "high" | "critical",
  status: "pending" | "in_progress" | "done",
  assignedTo: [workerIds],
  autoGenerated: boolean,
  createdAt: timestamp
}
```

**reports**

```javascript
{
  id: string,
  handlerId: string,
  fieldId: string,
  reportType: string,
  data: object,
  status: "pending_review" | "approved" | "rejected",
  submittedDate: timestamp
}
```

**notifications**

```javascript
{
  id: string,
  userId?: string,      // Personal notification
  role?: string,        // Broadcast to role
  title: string,
  message: string,
  type: string,
  relatedEntityId?: string,
  status: "unread" | "read",
  timestamp: timestamp
}
```

---

## Deployment

### Firebase Hosting

```bash
# Deploy everything
firebase deploy

# Deploy specific services
firebase deploy --only hosting
firebase deploy --only firestore:rules
firebase deploy --only functions
```

### Environment Variables

No environment variables needed for client-side app. Firebase config is in `firebase-config.js`.

For Cloud Functions (optional):

```bash
firebase functions:config:set someservice.key="THE API KEY"
```

---

## Development

### Running Emulators

```bash
firebase emulators:start
```

This starts:

- Firestore emulator (port 8080)
- Authentication emulator (port 9099)
- Functions emulator (port 5001)
- Hosting emulator (port 5000)
- Storage emulator (port 9199)

### Code Style

- ES6 modules with `import/export`
- Async/await for asynchronous operations
- Modular design with role-based organization
- Comments for complex logic
- Firestore real-time listeners (`onSnapshot`) for live updates

---

## Testing

### Manual Testing Checklist

**Field Registration Flow**

- [ ] Register field with all details
- [ ] Upload required documents
- [ ] Verify SRA receives notification
- [ ] SRA reviews and approves field
- [ ] Field appears on handler dashboard

**Task Automation Flow**

- [ ] Mark field as "Planting Complete"
- [ ] Verify 9 tasks auto-generated
- [ ] Check task priorities and deadlines
- [ ] Verify dashboard warnings appear for overdue tasks

**Worker Flow**

- [ ] Worker requests to join field
- [ ] Handler approves request
- [ ] Worker logs task with photos
- [ ] Handler reviews task log

**Driver Flow**

- [ ] Apply for driver badge
- [ ] Admin approves badge
- [ ] Handler rents driver
- [ ] Driver views assigned tasks

---

## Troubleshooting

### Common Issues

**"Permission denied" errors**

- Check Firestore security rules
- Verify user is authenticated
- Ensure user has correct role

**Tasks not auto-generating**

- Verify field has `plantingDate` set
- Check console for errors
- Ensure `growth-tracker.js` is imported

**Notifications not appearing**

- Check notification bell is initialized
- Verify real-time listener is active
- Check browser console for errors

**Map not loading**

- Verify internet connection (loads OpenStreetMap tiles)
- Check Leaflet.js is loaded
- Inspect browser console for errors

---

## Contributing

We welcome contributions! Here's how:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit with clear messages (`git commit -m 'Add amazing feature'`)
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Coding Guidelines

- Follow existing code style
- Add comments for complex logic
- Test in Firebase emulators before deploying
- Update documentation if adding features
- Use descriptive variable names

---

## License

This project is proprietary software developed for sugarcane farm management in Ormoc City, Philippines.

---

## Support

For issues, questions, or feature requests:

- **GitHub Issues**: [Report a bug](https://github.com/yourusername/CaneMap/issues)
- **Email**: support@canemap.com
- **Documentation**: Check this README and inline code comments

---

## Acknowledgments

**Technology Partners**

- **Firebase** - Google's app development platform
- **OpenStreetMap** - Free map data
- **Leaflet.js** - Open-source mapping library
- **Tailwind CSS** - Utility-first CSS framework

**Agricultural Guidance**

- **Sugar Regulatory Administration (SRA)** - Regulatory framework and compliance requirements
- **Philippine Sugar Research Institute** - Crop cycle and variety information

---

**CaneMap** - Modernizing sugarcane farming, one field at a time 🌾
