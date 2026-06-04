# PinPointer Meta Ads Optimizer v3.6.0

**Unified Dashboard for Meta Ads, Google Ads, and Google Analytics**

A comprehensive advertising optimization platform that brings together Meta Ads, Google Ads, and Google Analytics in one powerful dashboard with advanced metrics, date range selectors, and real-time insights.

![PinPointer](public/static/pinpointer-logo.jpg)

---

## 🌟 Features

### Meta Ads Dashboard
- ✅ **90+ Ad Accounts** - Full pagination support for unlimited accounts
- ✅ **Date Range Selector** - Today, Yesterday, Last 7/30 Days, This/Last Month
- ✅ **Campaign Search & Filters** - NEW! Search by name + status filters (Active/Paused/Ended/All)
- ✅ **Objective-Aware Optimization** - Smart alerts based on campaign objective (Awareness, Traffic, Leads, Sales, etc.)
- ✅ **Country-Sensitive Benchmarks** - 9 MENA markets including Jordan with localized CPM/CPC/CTR targets
- ✅ **Campaign Insights** - Comprehensive metrics and performance data
- ✅ **Budget Optimization** - AI-powered suggestions for campaign improvement
- ✅ **Real-Time Data** - Live metrics updated automatically
- ✅ **Settings Page** - User-configurable Meta access tokens

### Google Analytics Dashboard
- ✅ **OAuth Authentication** - Secure Google account integration
- ✅ **Flexible Date Ranges** - 7, 14, 30, 60, 90 days
- ✅ **14+ Metrics** including:
  - Key Metrics: Users, Sessions, Page Views, Bounce Rate
  - User Insights: New Users, Returning Users
  - Engagement Analysis: Engagement Rate, Time on Site
  - Session Behavior: Pages per Session, Avg Session Duration
  - Quick Insights: User engagement quality scores

### Google Ads Dashboard
- ✅ **OAuth Authentication** - Secure integration with Google Ads
- ✅ **Developer Token Support** - Full API access
- ✅ **Date Range Selector** - 7, 14, 30, 60, 90 days
- ✅ **Campaign Metrics** - Impressions, Clicks, CTR, Spend, Conversions, Budget
- ✅ **Multi-Account Support** - Manage multiple Google Ads accounts

---

## 🚀 Tech Stack

- **Framework**: [Hono](https://hono.dev/) - Lightweight web framework for Cloudflare Workers
- **Platform**: [Cloudflare Pages](https://pages.cloudflare.com/) - Edge deployment
- **Build Tool**: [Vite](https://vitejs.dev/) - Fast build tool
- **Language**: TypeScript
- **Frontend**: HTML5, TailwindCSS (CDN), Vanilla JavaScript
- **APIs**: Meta Marketing API, Google Analytics Data API, Google Ads API
- **Process Manager**: PM2 (development)

---

## 📦 Installation

### Prerequisites
- Node.js 18+ and npm
- Cloudflare account (for deployment)
- Meta Developer account with app credentials
- Google Cloud project with Analytics & Ads APIs enabled

### Setup

1. **Clone the repository**
```bash
git clone https://github.com/mabuadas/PinPointer-Meta-Ads.git
cd PinPointer-Meta-Ads
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**

Create a `.dev.vars` file in the root directory:

```env
# Meta Marketing API Configuration
META_ACCESS_TOKEN=your_meta_access_token
META_APP_ID=your_app_id
META_BUSINESS_ID=your_business_id
META_API_VERSION=v24.0

# Google API Configuration
GOOGLE_API_KEY=your_google_api_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_ADS_DEVELOPER_TOKEN=your_google_ads_dev_token
```

4. **Build the project**
```bash
npm run build
```

5. **Start development server**
```bash
npm run dev:sandbox
```

The application will be available at `http://localhost:3001`

---

## 🔐 API Credentials Setup

### Meta Marketing API

1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Create a new app or select existing app
3. Navigate to **Tools > Graph API Explorer**
4. Generate an access token with these permissions:
   - `ads_read`
   - `ads_management`
   - `read_insights`
   - `business_management` ⚠️ **Required**
5. Get a long-lived token (60 days) for production use

### Google Analytics API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable **Google Analytics Data API**
4. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs: Add your application URL + `/oauth/callback`
5. Copy Client ID and Client Secret

### Google Ads API

1. Go to [Google Ads API Center](https://ads.google.com/aw/apicenter)
2. Apply for API access
3. Once approved, get your Developer Token
4. Use OAuth 2.0 for authentication (same as Analytics)

---

## 📝 Usage

### Meta Ads
1. The dashboard loads automatically with your configured Meta access token
2. Select date range from dropdown
3. Choose an ad account from the list (90+ accounts supported)
4. View campaigns with detailed metrics and optimization suggestions

### Google Analytics
1. Click "Connect Google Analytics"
2. Complete OAuth flow
3. Select a property from your account
4. Choose date range (7-90 days)
5. View comprehensive metrics across 5 sections

### Google Ads
1. Click "Connect Google Ads Account"
2. Complete OAuth flow
3. Select an account
4. Choose date range (7-90 days)
5. View campaign performance metrics

---

## 🛠️ Development

### Available Scripts

```bash
# Development
npm run dev              # Start Vite dev server
npm run dev:sandbox      # Start Wrangler Pages dev server (port 3001)
npm run build            # Build for production

# Deployment
npm run deploy           # Deploy to Cloudflare Pages
npm run deploy:prod      # Deploy to production project

# Utilities
npm run clean-port       # Kill process on port 3001
npm run test             # Test local endpoint
```

### Project Structure

```
PinPointer-Meta-Ads/
├── src/
│   └── index.tsx              # Main application entry point
├── public/
│   └── static/
│       ├── pinpointer-logo.jpg
│       └── styles.css
├── dist/                      # Build output
├── .dev.vars                  # Environment variables (not in git)
├── ecosystem.config.cjs       # PM2 configuration
├── package.json
├── tsconfig.json
├── vite.config.ts
├── wrangler.jsonc            # Cloudflare configuration
└── README.md
```

---

## 🚀 Deployment

### Cloudflare Pages

1. **Build the project**
```bash
npm run build
```

2. **Deploy to Cloudflare**
```bash
npx wrangler pages deploy dist --project-name pinpointer-meta-ads
```

3. **Set environment variables** in Cloudflare Dashboard:
   - Go to Pages > Your Project > Settings > Environment Variables
   - Add all variables from `.dev.vars`

4. **Access your deployed application**
   - URL: `https://pinpointer-meta-ads.pages.dev`

---

## 📊 Features Breakdown

### Data Architecture
- **Meta Ads**: Direct API integration with Graph API v24.0
- **Google Analytics**: Google Analytics Data API (GA4)
- **Google Ads**: Google Ads API v17
- **Storage**: No database required - all data fetched in real-time

### Pagination System
- Automatically fetches all pages from Meta Ads API
- Supports 90+ ad accounts seamlessly
- Efficient batch processing

### Date Range Handling
- Consistent date selectors across all platforms
- Supports custom ranges from 7 to 90 days
- Automatic format conversion for each API
- Date changes now trigger automatic campaign data reload

### Campaign Filtering System (NEW in v3.6.0)
- **Search Bar**: Real-time search by campaign name (case-insensitive)
- **Status Filters**: 4 quick filter buttons
  - 🗂️ All Campaigns (default)
  - ▶️ Active campaigns only
  - ⏸️ Paused campaigns only
  - ⏹️ Ended campaigns (past stop_time)
- **Campaign Counter**: Live count of filtered results ("X campaigns")
- **Combined Filtering**: Search + Status filters work together
- **Performance**: Instant filtering for < 100 campaigns

### Objective-Aware Optimization (NEW in v3.6.0)
- **6 Objective Families**: Awareness, Traffic, Engagement, Leads, App Promotion, Sales
- **Smart KPI Selection**: Only relevant metrics checked per objective
  - Awareness: Impressions, Reach, CPM, CTR (NO conversion checks)
  - Traffic: Clicks, CPC, CTR (NO conversion checks)
  - Leads/Sales: Conversions, CPL, Conversion Rate, ROAS
- **Platform Rules**: Meta learning phase (50 events/week), Google Smart Bidding (50/15 conversions)
- **Country Benchmarks**: Jordan, UAE, Saudi Arabia, Kuwait, Oman, Bahrain, Qatar, Lebanon, Egypt
- **Alert Categories**: Platform Rules, Country Benchmarks, Best Practices

---

## 🔒 Security

- ✅ Environment variables for sensitive credentials
- ✅ OAuth 2.0 for Google services
- ✅ Tokens never exposed in frontend code
- ✅ Secure API-to-API communication
- ✅ No client-side storage of tokens

---

## 📈 Performance

- ⚡ Edge deployment via Cloudflare Workers
- ⚡ Global CDN distribution
- ⚡ Minimal bundle size (~199 KB)
- ⚡ Fast API response times
- ⚡ Efficient pagination and caching
- ⚡ Real-time filtering (< 50ms for < 100 campaigns)

---

## 🐛 Known Issues & Recent Fixes

### ✅ Fixed in v3.6.0
1. **JavaScript Error**: "Cannot access 'c' before initialization" in optimization modal - FIXED
2. **Campaigns Without Data**: Now show user-friendly error messages instead of crashing
3. **Date Filter Not Working**: Date range changes now trigger automatic data reload
4. **Awareness Campaigns**: No longer show irrelevant conversion alerts

### Known Issues
1. **Google Ads Developer Token**: Requires approval from Google (can take several days)
2. **Meta Token Expiration**: Short-lived tokens expire quickly - use long-lived tokens or Settings page
3. **OAuth Popup Blockers**: Users may need to allow popups for OAuth flows

---

## 📄 License

This project is private and proprietary.

---

## 👤 Author

**Moe Adas**
- GitHub: [@mabuadas](https://github.com/mabuadas)

---

## 🙏 Acknowledgments

- [Hono](https://hono.dev/) - Fast web framework
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge computing platform
- [Meta Marketing API](https://developers.facebook.com/docs/marketing-apis)
- [Google Analytics API](https://developers.google.com/analytics)
- [Google Ads API](https://developers.google.com/google-ads/api)

---

## 📞 Support

For issues or questions, please open an issue on GitHub or contact the author.

---

**Version**: 3.6.0  
**Last Updated**: June 4, 2026  
**Status**: ✅ Production Ready

---

## 📋 Recent Updates (v3.6.0)

### New Features
- ✨ Campaign search bar with real-time filtering
- ✨ Status filter buttons (All/Active/Paused/Ended)
- ✨ Campaign counter showing filtered results
- ✨ Date range now triggers automatic data reload
- ✨ Settings page for user-configurable tokens

### Bug Fixes
- 🐛 Fixed JavaScript error "Cannot access 'c' before initialization"
- 🐛 Fixed campaigns without data showing proper error messages
- 🐛 Fixed optimization modal crashes
- 🐛 Fixed date filter not working

### Optimization Improvements
- 🎯 Objective-aware alerts (no more conversion alerts for awareness campaigns)
- 🌍 Country-sensitive benchmarks (9 MENA markets including Jordan)
- 📊 Platform-specific rules (Meta learning phase, Google Smart Bidding)

For detailed documentation see:
- `DEPLOYMENT_SUMMARY.md` - Quick deployment reference
- `FILTER_FEATURE_GUIDE.md` - Technical implementation details
- `TEST_CHECKLIST.md` - Comprehensive testing scenarios
- `IMPLEMENTATION_SUMMARY.md` - Objective-aware optimization docs
