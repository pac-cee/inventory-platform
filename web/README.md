# Verlet Robotics - Web Inventory & Expense Dashboard

This is the Next.js web client for the Verlet Robotics system. It provides a comprehensive dashboard for inventory management, stock tracking, and corporate expense requests.

## Features

- **Inventory Tracking:** Real-time visibility into parts, components, and stock levels across multiple storage locations.
- **Stock Movements:** Intuitive check-out/check-in logs that automatically synchronize with overall stock levels.
- **Corporate Expense Requests (MoMo):** Employees can assemble a "Request Cart" for new purchases, attach receipts/photos, and specify an MTN MoMo recipient number.
- **Admin Budgeting:** Admins can define monthly global budget allocations and establish daily, monthly, and per-transaction spending limits for individual employees.
- **Payment Disbursement:** Approved transactions automatically trigger the Express backend to disburse funds directly to the recipient via the MTN MoMo API, subsequently updating the stock registry upon success.
- **Reporting:** Export comprehensive corporate expense ledgers as CSVs, or view personal spending footprints natively in the dashboard.

## Architecture & Communication

This web client does **not** communicate directly with the Supabase PostgreSQL database. Instead, it securely proxies requests through the Next.js App Router (`/api/*`) which then calls our standalone **Express API** (hosted on Railway). 
The Express API acts as the bridge that enforces Row Level Security using the user's forwarded JWT token, ensuring that sensitive credentials (like MTN MoMo API keys) never touch the browser.

## Getting Started

First, ensure you have the required environment variables in your `.env.local` file (see `.env.example`).

Run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## Deployment

This application is optimized to be deployed seamlessly to Vercel:

```bash
npx vercel --prod
```
esNow 