// Admin utilities
export const ADMIN_EMAIL = 'jaqbek.eth@gmail.com';

export const isAdmin = (user) => {
  return user?.email === ADMIN_EMAIL;
};

export const checkAdminPermission = (user, action = 'general') => {
  if (!isAdmin(user)) {
    console.warn(`Unauthorized ${action} attempt by ${user?.email || 'anonymous'}`);
    return false;
  }
  return true;
};