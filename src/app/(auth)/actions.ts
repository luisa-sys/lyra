'use server';

import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';

function getSiteUrl() {
  // Use explicit env var if set, otherwise derive from headers
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  return 'https://dev.checklyra.com';
}

export async function signUp(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const fullName = formData.get('full_name') as string;

  if (!email || !password || !fullName) {
    return redirect('/signup?error=' + encodeURIComponent('All fields are required'));
  }

  if (password.length < 6) {
    return redirect('/signup?error=' + encodeURIComponent('Password must be at least 6 characters'));
  }

  const siteUrl = getSiteUrl();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback`,
      data: {
        full_name: fullName,
      },
    },
  });

  if (error) {
    return redirect('/signup?error=' + encodeURIComponent(error.message));
  }

  return redirect('/signup?message=' + encodeURIComponent('Check your email to confirm your account'));
}

export async function signIn(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return redirect('/login?error=' + encodeURIComponent('Email and password are required'));
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return redirect('/login?error=' + encodeURIComponent(error.message));
  }

  return redirect('/dashboard');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirect('/');
}
