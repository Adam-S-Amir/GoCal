/**
 * Google Calendar API Service
 * Handles OAuth2 client instantiation, token refreshes, and calendar CRUD operations.
 */
import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
];

import type { Credentials } from 'google-auth-library';

export type UserTokens = Credentials;

export function getOAuth2Client(redirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const defaultRedirect = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/callback';

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri || defaultRedirect
  );
}

export function generateAuthUrl(redirectUri?: string, state?: string) {
  const oauth2Client = getOAuth2Client(redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    include_granted_scopes: true,
    state: state || 'gocal_state',
  });
}

export async function exchangeCodeForTokens(code: string, redirectUri?: string) {
  const oauth2Client = getOAuth2Client(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Fetch basic user profile
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();

  return {
    tokens,
    user: {
      id: userInfo.data.id || '',
      email: userInfo.data.email || '',
      name: userInfo.data.name || 'Calendar User',
      picture: userInfo.data.picture || '',
    },
  };
}

export function getCalendarClient(tokens: UserTokens) {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export async function listUpcomingEvents(tokens: UserTokens, maxResults = 10, timeMin?: string) {
  const calendar = getCalendarClient(tokens);
  const minTime = timeMin || new Date().toISOString();

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: minTime,
    maxResults: maxResults,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return response.data.items || [];
}

export async function createCalendarEvent(
  tokens: UserTokens,
  summary: string,
  startTime: string,
  endTime: string,
  description = 'Created by Callie via GoCal'
) {
  const calendar = getCalendarClient(tokens);

  const startIso = new Date(startTime).toISOString();
  const endIso = new Date(endTime).toISOString();

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary,
      description,
      start: { dateTime: startIso, timeZone: 'America/New_York' },
      end: { dateTime: endIso, timeZone: 'America/New_York' },
    },
  });

  return response.data;
}

export async function removeCalendarEvent(tokens: UserTokens, eventTitle: string) {
  const calendar = getCalendarClient(tokens);
  const upcoming = await listUpcomingEvents(tokens, 20);

  const found = upcoming.find(
    (e) => e.summary && e.summary.toLowerCase().includes(eventTitle.toLowerCase())
  );

  if (!found || !found.id) {
    return { success: false, message: `No upcoming event matching "${eventTitle}" was found.` };
  }

  await calendar.events.delete({
    calendarId: 'primary',
    eventId: found.id,
  });

  return { success: true, message: `Removed "${found.summary}" from your calendar.` };
}

export async function updateCalendarEvent(
  tokens: UserTokens,
  eventTitle: string,
  newStartTime?: string,
  newEndTime?: string,
  newSummary?: string,
  newDescription?: string
) {
  const calendar = getCalendarClient(tokens);
  const upcoming = await listUpcomingEvents(tokens, 20);

  const found = upcoming.find(
    (e) => e.summary && e.summary.toLowerCase().includes(eventTitle.toLowerCase())
  );

  if (!found || !found.id) {
    return { success: false, message: `No event matching "${eventTitle}" was found to update.` };
  }

  const patchBody: any = {};
  if (newSummary) patchBody.summary = newSummary;
  if (newDescription) patchBody.description = newDescription;
  if (newStartTime) {
    patchBody.start = { dateTime: new Date(newStartTime).toISOString(), timeZone: 'America/New_York' };
  }
  if (newEndTime) {
    patchBody.end = { dateTime: new Date(newEndTime).toISOString(), timeZone: 'America/New_York' };
  }

  const response = await calendar.events.patch({
    calendarId: 'primary',
    eventId: found.id,
    requestBody: patchBody,
  });

  return { success: true, event: response.data, message: `Updated "${response.data.summary}".` };
}

export async function addDueDateMarker(tokens: UserTokens, taskName: string, dueDate: string, courseName = '') {
  const calendar = getCalendarClient(tokens);
  const title = courseName ? `DUE: ${courseName} - ${taskName}` : `DUE: ${taskName}`;

  // Formatted as all-day event
  const d = new Date(dueDate);
  const dateStr = d.toISOString().split('T')[0];

  const nextDay = new Date(d);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().split('T')[0];

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      start: { date: dateStr },
      end: { date: nextDayStr },
      description: 'Assignment deadline created by Callie',
    },
  });

  return response.data;
}
