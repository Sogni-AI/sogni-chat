/**
 * Dance preset library for dance_montage tool.
 */

export interface DancePreset {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
}

const CDN_BASE = 'https://cdn.sogni.ai/video-samples';

export const DANCE_PRESETS: DancePreset[] = [
  {
    id: 'rasputin',
    title: 'Boney M - Rasputin',
    description: 'Viral Russian TikTok Dance',
    videoUrl: `${CDN_BASE}/rasputin.mp4`,
  },
  {
    id: 'big-guy',
    title: 'Ice Spice - Big Guy',
    description: 'From "The SpongeBob Movie: Search for SquarePants" movie',
    videoUrl: `${CDN_BASE}/big-guy-dance.mp4`,
  },
  {
    id: 'keep-it-gangsta',
    title: 'Nhale ft. Dezzy Hollow - Keep it Gangsta',
    description: 'Hip-hop gangsta dance',
    videoUrl: `${CDN_BASE}/dance-keep-it-gangsta.mp4`,
  },
  {
    id: 'this-is-america',
    title: 'Childish Gambino - This Is America',
    description: 'Iconic choreography from the This Is America music video',
    videoUrl: `${CDN_BASE}/this-is-america.mp4`,
  },
  {
    id: 'chinese-new-year',
    title: '弥渡山歌 (Midu Echoing) - Dan Thy',
    description: 'Chinese New Year Dance, Chinese Military Dance Trend',
    videoUrl: `${CDN_BASE}/chinese-new-year-dance.mp4`,
  },
  {
    id: 'spongebob',
    title: 'SpongeBob - Stadium Rave',
    description: 'Jellyfish Jam Dance from SpongeBob SquarePants',
    videoUrl: `${CDN_BASE}/spongebob-dance.mp4`,
  },
  {
    id: 'chanel',
    title: 'Tyla - Chanel',
    description: 'Put me in Chanel dance',
    videoUrl: `${CDN_BASE}/chanel.mp4`,
  },
];
