import { config } from '../config.js';

// True se o membro tem o cargo da equipe.
export function isStaff(member) {
  if (!member) return false;
  return member.roles.cache.has(config.discord.staffRoleId);
}
