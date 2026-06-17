import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commandData } from './commands.js';

const rest = new REST({ version: '10' }).setToken(config.discord.token);

try {
  console.log(`Registrando ${commandData.length} comando(s) no servidor ${config.discord.guildId}…`);
  await rest.put(
    Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
    { body: commandData },
  );
  console.log('✅ Comandos registrados.');
} catch (err) {
  console.error('Erro ao registrar comandos:', err);
  process.exit(1);
}
