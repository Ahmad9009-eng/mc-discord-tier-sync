const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@libsql/client');

// Initialize Express App (Web API)
const app = express();
app.use(cors());
app.use(express.json());

// Initialize Turso Database (Cloud SQLite)
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

// Create Table if not exists
async function initDB() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS player_tiers (
      username TEXT PRIMARY KEY,
      vanilla TEXT,
      nethpot TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
initDB().catch(console.error);

// REST API Endpoints for Website & Minecraft
app.get('/api/tiers', async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM player_tiers ORDER BY updated_at DESC");
    res.json({ status: "success", data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tier/:username', async (req, res) => {
  try {
    const player = req.params.username;
    const result = await db.execute({
      sql: "SELECT * FROM player_tiers WHERE username = ?",
      args: [player]
    });
    if (result.rows.length === 0) {
      return res.json({ username: player, vanilla: "Unranked", nethpot: "Unranked" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Express Server Listener
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));

// Initialize Discord Bot
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('tieradd')
    .setDescription('Update player tier ratings')
    .addStringOption(opt => opt.setName('player').setDescription('Minecraft IGN').setRequired(true))
    .addStringOption(opt => opt.setName('vanilla').setDescription('Vanilla Tier (e.g., HT5)').setRequired(false))
    .addStringOption(opt => opt.setName('nethpot').setDescription('Nethpot Tier (e.g., HT5)').setRequired(false))
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('Slash commands registered!');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'tieradd') {
    const player = interaction.options.getString('player');
    const vanilla = interaction.options.getString('vanilla') || 'Unranked';
    const nethpot = interaction.options.getString('nethpot') || 'Unranked';

    try {
      await db.execute({
        sql: `INSERT INTO player_tiers (username, vanilla, nethpot, updated_at)
              VALUES (?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(username) DO UPDATE SET
                vanilla = excluded.vanilla,
                nethpot = excluded.nethpot,
                updated_at = CURRENT_TIMESTAMP`,
        args: [player, vanilla, nethpot]
      });

      await interaction.reply({
        content: `Successfully updated **${player}**:\n- **Vanilla:** ${vanilla}\n- **Nethpot:** ${nethpot}`
      });
    } catch (err) {
      await interaction.reply({ content: `Database Error: ${err.message}`, ephemeral: true });
    }
  }
});

if (process.env.BOT_TOKEN) {
  client.login(process.env.BOT_TOKEN);
}
