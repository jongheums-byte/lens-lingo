import { PERSONAS } from '../config/personas';
import { createStickerDataUrlFromImage } from '../lib/bboxCrop';
import type {
  Box2D,
  CoachingTip,
  ConversationScenarioId,
  ExtractedVocab,
  PersonaId,
  ProficiencyLevel,
  SavedVocabCard,
  SuggestedReply,
  TargetLanguageCode,
  TutorResponsePayload,
} from '../types/app';

export type DemoSceneId = 'cafe' | 'ramen' | 'station' | 'desk';

export interface DemoSceneInfo {
  id: DemoSceneId;
  title: string;
  subtitle: string;
  badge: string;
  box2dPrimary: Box2D;
  box2dSecondary: Box2D;
}

export const DEMO_SCENES: DemoSceneInfo[] = [
  {
    id: 'cafe',
    title: '카페 아이스 라떼 & 크루아상',
    subtitle: '카운터 테이블 위 음료와 베이커리',
    badge: '☕ 카페',
    box2dPrimary: [210, 140, 820, 520],
    box2dSecondary: [390, 510, 800, 890],
  },
  {
    id: 'ramen',
    title: '로컬 식당 메뉴판',
    subtitle: '돈코츠 라멘과 교자 메뉴',
    badge: '🍜 식당',
    box2dPrimary: [170, 140, 830, 860],
    box2dSecondary: [540, 220, 770, 780],
  },
  {
    id: 'station',
    title: '지하철 출구 안내 표지판',
    subtitle: '승강장과 티켓 발권기 방향',
    badge: '🚇 교통',
    box2dPrimary: [180, 130, 620, 870],
    box2dSecondary: [640, 250, 860, 750],
  },
  {
    id: 'desk',
    title: '스터디 데스크와 헤드폰',
    subtitle: '노트북·무선 헤드폰·머그컵',
    badge: '🎧 일상',
    box2dPrimary: [220, 540, 760, 890],
    box2dSecondary: [260, 120, 790, 540],
  },
];

const sceneImageCache = new Map<DemoSceneId, string>();

export function renderDemoSceneDataUrl(sceneId: DemoSceneId): string {
  const cached = sceneImageCache.get(sceneId);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 960;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Rich warm or moody atmospheric backdrop
  const bg = ctx.createLinearGradient(0, 0, 720, 960);
  if (sceneId === 'cafe') {
    bg.addColorStop(0, '#1e1b18');
    bg.addColorStop(0.55, '#3b2c22');
    bg.addColorStop(1, '#181411');
  } else if (sceneId === 'ramen') {
    bg.addColorStop(0, '#1b1318');
    bg.addColorStop(0.55, '#3a1d24');
    bg.addColorStop(1, '#140f12');
  } else if (sceneId === 'station') {
    bg.addColorStop(0, '#0f172a');
    bg.addColorStop(0.6, '#1e293b');
    bg.addColorStop(1, '#090d16');
  } else {
    bg.addColorStop(0, '#111827');
    bg.addColorStop(0.55, '#1e293b');
    bg.addColorStop(1, '#0f172a');
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 720, 960);

  // Ambient bokeh circles
  const bokehColors = ['rgba(56,189,248,0.14)', 'rgba(251,191,36,0.16)', 'rgba(52,211,153,0.12)'];
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = bokehColors[i % bokehColors.length];
    ctx.beginPath();
    ctx.arc(110 + i * 110, 160 + (i % 3) * 90, 55 + (i % 2) * 30, 0, Math.PI * 2);
    ctx.fill();
  }

  // Table surface
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, 620, 720, 340);

  if (sceneId === 'cafe') {
    // Iced Latte cup
    ctx.fillStyle = 'rgba(248, 250, 252, 0.22)';
    ctx.strokeStyle = 'rgba(255,255,255,0.48)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(150, 330);
    ctx.lineTo(340, 330);
    ctx.lineTo(312, 740);
    ctx.lineTo(178, 740);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Espresso + milk gradient inside cup
    const coffee = ctx.createLinearGradient(0, 360, 0, 730);
    coffee.addColorStop(0, '#6f4e37');
    coffee.addColorStop(0.45, '#c49a6c');
    coffee.addColorStop(1, '#f5e6d3');
    ctx.fillStyle = coffee;
    ctx.beginPath();
    ctx.moveTo(160, 380);
    ctx.lineTo(330, 380);
    ctx.lineTo(306, 730);
    ctx.lineTo(184, 730);
    ctx.closePath();
    ctx.fill();

    // Ice cubes
    ctx.fillStyle = 'rgba(224,242,254,0.45)';
    ctx.fillRect(190, 395, 52, 48);
    ctx.fillRect(252, 412, 48, 44);

    // Straw
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(275, 220);
    ctx.lineTo(245, 540);
    ctx.stroke();

    // Croissant plate + golden croissant
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.ellipse(505, 680, 140, 56, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#d97706';
    ctx.beginPath();
    ctx.ellipse(505, 640, 108, 52, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.ellipse(505, 628, 76, 36, -0.15, 0, Math.PI * 2);
    ctx.fill();
  } else if (sceneId === 'ramen') {
    // Menu wooden board
    ctx.fillStyle = '#faf5ef';
    ctx.beginPath();
    ctx.roundRect(105, 175, 510, 620, 28);
    ctx.fill();
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 10;
    ctx.stroke();

    ctx.fillStyle = '#991b1b';
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TONKOTSU MENU', 360, 270);

    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('1. Signature Ramen  ¥980', 360, 380);
    ctx.fillText('2. Crispy Gyoza     ¥450', 360, 460);
    ctx.fillText('3. Green Tea        ¥250', 360, 540);

    // Stylized ramen bowl badge
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(360, 675, 78, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.ellipse(360, 675, 78, 22, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (sceneId === 'station') {
    // Overhead sign
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(95, 190, 530, 360, 24);
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.roundRect(130, 225, 120, 62, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT B2', 190, 268);

    ctx.textAlign = 'left';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('← Central Platform', 135, 365);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('Ticket Office →', 135, 445);
  } else {
    // Laptop on left + wireless headphones on right
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(95, 310, 300, 220, 18);
    ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(118, 334, 254, 172);
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.roundRect(75, 535, 340, 42, 12);
    ctx.fill();

    // Wireless headphones
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.arc(525, 450, 95, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#6366f1';
    ctx.beginPath();
    ctx.roundRect(408, 445, 46, 98, 22);
    ctx.roundRect(596, 445, 46, 98, 22);
    ctx.fill();
  }

  // Subtle corner tag
  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  ctx.beginPath();
  ctx.roundRect(28, 28, 200, 44, 22);
  ctx.fill();
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('DEMO AR SCENE', 52, 57);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  sceneImageCache.set(sceneId, dataUrl);
  return dataUrl;
}

interface LangDemoVocabulary {
  word: string;
  reading: string;
  koreanPronunciation: string;
  meaning: string;
  partOfSpeech: string;
  exampleTarget: string;
  exampleKorean: string;
  phrase: string;
}

const DEMO_CONTENT: Record<
  DemoSceneId,
  Record<TargetLanguageCode, [LangDemoVocabulary, LangDemoVocabulary]>
> = {
  cafe: {
    en: [
      {
        word: 'Iced Latte',
        reading: '/aɪst ˈlɑːteɪ/',
        koreanPronunciation: '아이스드 라떼',
        meaning: '아이스 카페 라떼',
        partOfSpeech: '명사',
        exampleTarget: 'Can I get an iced latte to go?',
        exampleKorean: '아이스 라떼 테이크아웃으로 주시겠어요?',
        phrase: 'Can I get an iced latte, please?',
      },
      {
        word: 'Croissant',
        reading: '/krwɑːˈsɒ̃/',
        koreanPronunciation: '크와쌍',
        meaning: '크루아상',
        partOfSpeech: '명사',
        exampleTarget: 'Could you warm up this croissant?',
        exampleKorean: '이 크루아상 좀 데워 주실 수 있나요?',
        phrase: 'warm it up',
      },
    ],
    ja: [
      {
        word: 'アイスラテ',
        reading: 'あいすらて (aisu rate)',
        koreanPronunciation: '아이스 라테',
        meaning: '아이스 라떼',
        partOfSpeech: '명사',
        exampleTarget: 'アイスラテを一つお願いします。',
        exampleKorean: '아이스 라떼 하나 부탁합니다.',
        phrase: 'アイスラテを一つください',
      },
      {
        word: 'クロワッサン',
        reading: 'くろわっさん (kurowassan)',
        koreanPronunciation: '쿠로왓산',
        meaning: '크루아상',
        partOfSpeech: '명사',
        exampleTarget: 'このクロワッサンを温めてもらえますか。',
        exampleKorean: '이 크루아상을 데워 주실 수 있나요?',
        phrase: '温めてください',
      },
    ],
    zh: [
      {
        word: '冰拿铁',
        reading: 'bīng ná tiě',
        koreanPronunciation: '빙 나티에',
        meaning: '아이스 라떼',
        partOfSpeech: '명사',
        exampleTarget: '请给我一杯冰拿铁。',
        exampleKorean: '아이스 라떼 한 잔 주세요.',
        phrase: '我要一杯冰拿铁',
      },
      {
        word: '牛角包',
        reading: 'niú jiǎo bāo',
        koreanPronunciation: '니우 자오 바오',
        meaning: '크루아상',
        partOfSpeech: '명사',
        exampleTarget: '请帮我加热这个牛角包。',
        exampleKorean: '이 크루아상 데워 주세요.',
        phrase: '牛角包',
      },
    ],
    es: [
      {
        word: 'Café con hielo',
        reading: 'ka-FE kon YE-lo',
        koreanPronunciation: '카페 콘 이엘로',
        meaning: '아이스 커피 / 라떼',
        partOfSpeech: '명사구',
        exampleTarget: 'Un café con leche y hielo, por favor.',
        exampleKorean: '아이스 카페 라떼 한 잔 주세요.',
        phrase: 'Un café con hielo, por favor',
      },
      {
        word: 'Cruasán',
        reading: 'kwa-SAN',
        koreanPronunciation: '크루아산',
        meaning: '크루아상',
        partOfSpeech: '명사',
        exampleTarget: '¿Me pone un cruasán también?',
        exampleKorean: '크루아상도 하나 주시겠어요?',
        phrase: 'cruasán',
      },
    ],
    fr: [
      {
        word: 'Café glacé',
        reading: 'ka-fe gla-se',
        koreanPronunciation: '카페 글라세',
        meaning: '아이스 커피',
        partOfSpeech: '명사구',
        exampleTarget: 'Je voudrais un café glacé, s’il vous plaît.',
        exampleKorean: '아이스 커피 한 잔 주세요.',
        phrase: 'Un café glacé, s’il vous plaît',
      },
      {
        word: 'Croissant',
        reading: 'kʁwa-sɑ̃',
        koreanPronunciation: '크와상',
        meaning: '크루아상',
        partOfSpeech: '명사',
        exampleTarget: 'Un croissant bien chaud, merci.',
        exampleKorean: '따뜻한 크루아상 하나 주세요.',
        phrase: 'un croissant',
      },
    ],
    de: [
      {
        word: 'Eiskaffee',
        reading: 'AIS-ka-fe',
        koreanPronunciation: '아이스카페',
        meaning: '아이스 커피',
        partOfSpeech: '남성명사 (der)',
        exampleTarget: 'Ich hätte gern einen Eiskaffee.',
        exampleKorean: '아이스 커피 한 잔 주문할게요.',
        phrase: 'Einen Eiskaffee, bitte',
      },
      {
        word: 'Croissant',
        reading: 'kroa-SANG',
        koreanPronunciation: '크로아상',
        meaning: '크루아상',
        partOfSpeech: '중성명사 (das)',
        exampleTarget: 'Und ein Croissant zum Mitnehmen.',
        exampleKorean: '그리고 크루아상 하나 포장해 주세요.',
        phrase: 'zum Mitnehmen',
      },
    ],
    it: [
      {
        word: 'Caffè freddo',
        reading: 'kaf-FE FRED-do',
        koreanPronunciation: '카페 프레도',
        meaning: '아이스 커피',
        partOfSpeech: '명사구',
        exampleTarget: 'Vorrei un caffè freddo, per favore.',
        exampleKorean: '아이스 커피 한 잔 부탁드려요.',
        phrase: 'Un caffè freddo, per favore',
      },
      {
        word: 'Cornetto',
        reading: 'kor-NET-to',
        koreanPronunciation: '코르네토',
        meaning: '이탈리아식 크루아상',
        partOfSpeech: '명사',
        exampleTarget: 'Un cornetto semplice, grazie.',
        exampleKorean: '플레인 코르네토 하나 주세요.',
        phrase: 'un cornetto',
      },
    ],
  },
  ramen: {
    en: [
      {
        word: 'Check the menu',
        reading: '/tʃɛk ðə ˈmɛnjuː/',
        koreanPronunciation: '첵 더 메뉴',
        meaning: '메뉴판을 보다',
        partOfSpeech: '표현',
        exampleTarget: 'What do you recommend on this menu?',
        exampleKorean: '이 메뉴판에서 어떤 메뉴를 추천하시나요?',
        phrase: 'What do you recommend?',
      },
      {
        word: 'Side dish',
        reading: '/saɪd dɪʃ/',
        koreanPronunciation: '사이드 디쉬',
        meaning: '사이드 메뉴',
        partOfSpeech: '명사',
        exampleTarget: 'Let us share a plate of gyoza as a side dish.',
        exampleKorean: '사이드로 교자 한 접시 같이 나눠 먹어요.',
        phrase: 'side dish',
      },
    ],
    ja: [
      {
        word: 'おすすめ',
        reading: 'osusume',
        koreanPronunciation: '오스스메',
        meaning: '추천 메뉴',
        partOfSpeech: '명사',
        exampleTarget: '今日のおすすめは何ですか。',
        exampleKorean: '오늘의 추천 메뉴는 무엇인가요?',
        phrase: 'おすすめは何ですか',
      },
      {
        word: '餃子 (ぎょうざ)',
        reading: 'ぎょうざ (gyōza)',
        koreanPronunciation: '교자',
        meaning: '군만두 / 교자',
        partOfSpeech: '명사',
        exampleTarget: 'ラーメンと餃子をお願いします。',
        exampleKorean: '라멘이랑 교자 하나 주세요.',
        phrase: '餃子もください',
      },
    ],
    zh: [
      {
        word: '菜单',
        reading: 'cài dān',
        koreanPronunciation: '차이단',
        meaning: '메뉴판',
        partOfSpeech: '명사',
        exampleTarget: '请问有什么招牌菜？',
        exampleKorean: '대표 추천 메뉴가 있나요?',
        phrase: '菜单',
      },
      {
        word: '煎饺',
        reading: 'jiān jiǎo',
        koreanPronunciation: '지엔자오',
        meaning: '군만두',
        partOfSpeech: '명사',
        exampleTarget: '再来一份煎饺。',
        exampleKorean: '군만두도 하나 추가해 주세요.',
        phrase: '煎饺',
      },
    ],
    es: [
      {
        word: 'La carta',
        reading: 'la KAR-ta',
        koreanPronunciation: '라 카르타',
        meaning: '메뉴판',
        partOfSpeech: '명사',
        exampleTarget: '¿Qué plato recomienda de la carta?',
        exampleKorean: '메뉴에서 어떤 요리를 추천하세요?',
        phrase: '¿Qué recomienda?',
      },
      {
        word: 'Para compartir',
        reading: 'PA-ra kom-par-TIR',
        koreanPronunciation: '파라 콤파르티르',
        meaning: '나눠 먹을 용도',
        partOfSpeech: '표현',
        exampleTarget: 'Queremos esto para compartir.',
        exampleKorean: '이건 같이 나눠 먹으려고요.',
        phrase: 'para compartir',
      },
    ],
    fr: [
      {
        word: 'La carte',
        reading: 'la kaʁt',
        koreanPronunciation: '라 카르트',
        meaning: '메뉴판',
        partOfSpeech: '명사',
        exampleTarget: 'Qu’est-ce que vous recommandez sur la carte ?',
        exampleKorean: '메뉴판에서 무엇을 추천하시나요?',
        phrase: 'Qu’est-ce que vous recommandez ?',
      },
      {
        word: 'Plat du jour',
        reading: 'pla dy ʒuʁ',
        koreanPronunciation: '플라 뒤 주르',
        meaning: '오늘의 요리',
        partOfSpeech: '명사구',
        exampleTarget: 'Je vais prendre le plat du jour.',
        exampleKorean: '오늘의 요리로 주문할게요.',
        phrase: 'plat du jour',
      },
    ],
    de: [
      {
        word: 'Speisekarte',
        reading: 'SHPAI-ze-kar-te',
        koreanPronunciation: '슈파이제카르테',
        meaning: '메뉴판',
        partOfSpeech: '여성명사 (die)',
        exampleTarget: 'Kann ich bitte die Speisekarte haben?',
        exampleKorean: '메뉴판 좀 주실 수 있나요?',
        phrase: 'die Speisekarte',
      },
      {
        word: 'Empfehlung',
        reading: 'emp-FE-lung',
        koreanPronunciation: '엠프펠룽',
        meaning: '추천 메뉴',
        partOfSpeech: '여성명사 (die)',
        exampleTarget: 'Was ist Ihre Empfehlung heute?',
        exampleKorean: '오늘 추천 메뉴가 뭔가요?',
        phrase: 'Ihre Empfehlung',
      },
    ],
    it: [
      {
        word: 'Il menù',
        reading: 'il me-NU',
        koreanPronunciation: '일 메누',
        meaning: '메뉴판',
        partOfSpeech: '명사',
        exampleTarget: 'Cosa consiglia dal menù?',
        exampleKorean: '메뉴에서 어떤 걸 추천하시나요?',
        phrase: 'Cosa consiglia?',
      },
      {
        word: 'Contorno',
        reading: 'kon-TOR-no',
        koreanPronunciation: '콘토르노',
        meaning: '사이드 디시',
        partOfSpeech: '명사',
        exampleTarget: 'Vorrei aggiungere un contorno.',
        exampleKorean: '사이드 메뉴를 하나 추가하고 싶어요.',
        phrase: 'un contorno',
      },
    ],
  },
  station: {
    en: [
      {
        word: 'Subway Exit',
        reading: '/ˈsʌbweɪ ˈɛɡzɪt/',
        koreanPronunciation: '서브웨이 엑짓',
        meaning: '지하철 출구',
        partOfSpeech: '명사구',
        exampleTarget: 'Which subway exit goes to the museum?',
        exampleKorean: '박물관으로 가려면 몇 번 출구로 나가야 하나요?',
        phrase: 'Which exit goes to...',
      },
      {
        word: 'Platform',
        reading: '/ˈplætfɔːrm/',
        koreanPronunciation: '플랫포옴',
        meaning: '승강장',
        partOfSpeech: '명사',
        exampleTarget: 'You can catch the express train on platform 2.',
        exampleKorean: '2번 승강장에서 급행 열차를 타실 수 있어요.',
        phrase: 'platform',
      },
    ],
    ja: [
      {
        word: '出口 (でぐち)',
        reading: 'でぐち (deguchi)',
        koreanPronunciation: '데구치',
        meaning: '출구',
        partOfSpeech: '명사',
        exampleTarget: 'B2出口はどちらですか。',
        exampleKorean: 'B2 출구는 어느 쪽인가요?',
        phrase: '出口はどちらですか',
      },
      {
        word: '改札口 (かいさつぐち)',
        reading: 'かいさつぐち (kaisatsuguchi)',
        koreanPronunciation: '카이사츠구치',
        meaning: '개찰구',
        partOfSpeech: '명사',
        exampleTarget: '改札口を出て左にあります。',
        exampleKorean: '개찰구를 나와서 왼쪽에 있습니다.',
        phrase: '改札口',
      },
    ],
    zh: [
      {
        word: '出口',
        reading: 'chū kǒu',
        koreanPronunciation: '추코우',
        meaning: '출구',
        partOfSpeech: '명사',
        exampleTarget: '请问B2出口怎么走？',
        exampleKorean: 'B2 출구로 어떻게 가나요?',
        phrase: '出口怎么走',
      },
      {
        word: '站台',
        reading: 'zhàn tái',
        koreanPronunciation: '잔타이',
        meaning: '승강장',
        partOfSpeech: '명사',
        exampleTarget: '去市中心的车在二号站台。',
        exampleKorean: '시내로 가는 열차는 2번 승강장에 있어요.',
        phrase: '站台',
      },
    ],
    es: [
      {
        word: 'Salida',
        reading: 'sa-LI-da',
        koreanPronunciation: '살리다',
        meaning: '출구',
        partOfSpeech: '명사',
        exampleTarget: '¿Dónde está la salida B2?',
        exampleKorean: 'B2 출구가 어디에 있나요?',
        phrase: '¿Dónde está la salida?',
      },
      {
        word: 'Andén',
        reading: 'an-DEN',
        koreanPronunciation: '안덴',
        meaning: '승강장',
        partOfSpeech: '명사',
        exampleTarget: 'El tren sale del andén central.',
        exampleKorean: '열차는 중앙 승강장에서 출발합니다.',
        phrase: 'el andén',
      },
    ],
    fr: [
      {
        word: 'Sortie',
        reading: 'sɔʁ-ti',
        koreanPronunciation: '소르티',
        meaning: '출구',
        partOfSpeech: '명사',
        exampleTarget: 'Où est la sortie B2, s’il vous plaît ?',
        exampleKorean: 'B2 출구가 어디인가요?',
        phrase: 'Où est la sortie ?',
      },
      {
        word: 'Quai',
        reading: 'kɛ',
        koreanPronunciation: '케',
        meaning: '승강장',
        partOfSpeech: '명사',
        exampleTarget: 'Le métro arrive sur le quai numéro 2.',
        exampleKorean: '지하철이 2번 승강장으로 들어옵니다.',
        phrase: 'le quai',
      },
    ],
    de: [
      {
        word: 'Ausgang',
        reading: 'AUS-gang',
        koreanPronunciation: '아우스강',
        meaning: '출구',
        partOfSpeech: '남성명사 (der)',
        exampleTarget: 'Wo ist der Ausgang B2?',
        exampleKorean: 'B2 출구가 어디인가요?',
        phrase: 'der Ausgang',
      },
      {
        word: 'Gleis',
        reading: 'glais',
        koreanPronunciation: '글라이스',
        meaning: '승강장 / 선로',
        partOfSpeech: '중성명사 (das)',
        exampleTarget: 'Der Zug fährt auf Gleis zwei ab.',
        exampleKorean: '열차가 2번 승강장에서 출발합니다.',
        phrase: 'Gleis',
      },
    ],
    it: [
      {
        word: 'Uscita',
        reading: 'u-SHI-ta',
        koreanPronunciation: '우시타',
        meaning: '출구',
        partOfSpeech: '명사',
        exampleTarget: 'Dov’è l’uscita B2?',
        exampleKorean: 'B2 출구가 어디에 있나요?',
        phrase: 'Dov’è l’uscita?',
      },
      {
        word: 'Binario',
        reading: 'bi-NA-ryo',
        koreanPronunciation: '비나리오',
        meaning: '승강장',
        partOfSpeech: '명사',
        exampleTarget: 'Il treno parte dal binario centrale.',
        exampleKorean: '열차는 중앙 승강장에서 출발해요.',
        phrase: 'binario',
      },
    ],
  },
  desk: {
    en: [
      {
        word: 'Headphones',
        reading: '/ˈhɛdfoʊnz/',
        koreanPronunciation: '헤드폰즈',
        meaning: '헤드폰',
        partOfSpeech: '복수명사',
        exampleTarget: 'My wireless headphones are out of battery.',
        exampleKorean: '내 무선 헤드폰 배터리가 다 닳았어요.',
        phrase: 'wireless headphones',
      },
      {
        word: 'Laptop',
        reading: '/ˈlæptɑːp/',
        koreanPronunciation: '랩탑',
        meaning: '노트북 컴퓨터',
        partOfSpeech: '명사',
        exampleTarget: 'I study languages on my laptop every evening.',
        exampleKorean: '매일 저녁 노트북으로 외국어를 공부해요.',
        phrase: 'laptop',
      },
    ],
    ja: [
      {
        word: 'ヘッドホン',
        reading: 'へっどほん (heddohon)',
        koreanPronunciation: '헷도혼',
        meaning: '헤드폰',
        partOfSpeech: '명사',
        exampleTarget: 'ワイヤレスヘッドホンで発音を聞きます。',
        exampleKorean: '무선 헤드폰으로 발음을 들어요.',
        phrase: 'ワイヤレスヘッドホン',
      },
      {
        word: 'ノートパソコン',
        reading: 'のーとぱそこん (nōto pasokon)',
        koreanPronunciation: '노토 파소콘',
        meaning: '노트북 (화제: 노트PC)',
        partOfSpeech: '명사',
        exampleTarget: '毎日ノートパソコンで日本語を勉強します。',
        exampleKorean: '매일 노트북으로 일본어를 공부해요.',
        phrase: 'ノートパソコン',
      },
    ],
    zh: [
      {
        word: '耳机',
        reading: 'ěr jī',
        koreanPronunciation: '얼지',
        meaning: '헤드폰 / 이어폰',
        partOfSpeech: '명사',
        exampleTarget: '戴上耳机听听力练习。',
        exampleKorean: '헤드폰을 쓰고 듣기 연습을 해요.',
        phrase: '戴上耳机',
      },
      {
        word: '笔记本电脑',
        reading: 'bǐ jì běn diàn nǎo',
        koreanPronunciation: '비지번 디엔나오',
        meaning: '노트북 컴퓨터',
        partOfSpeech: '명사',
        exampleTarget: '我在笔记本电脑上做笔记。',
        exampleKorean: '노트북에 필기를 해요.',
        phrase: '笔记本电脑',
      },
    ],
    es: [
      {
        word: 'Auriculares',
        reading: 'au-ri-ku-LA-res',
        koreanPronunciation: '아우리쿨라레스',
        meaning: '헤드폰 / 이어폰',
        partOfSpeech: '남성복수명사',
        exampleTarget: 'Uso auriculares inalámbricos para practicar.',
        exampleKorean: '연습할 때 무선 헤드폰을 써요.',
        phrase: 'auriculares inalámbricos',
      },
      {
        word: 'Portátil',
        reading: 'por-TA-til',
        koreanPronunciation: '포르타틸',
        meaning: '노트북',
        partOfSpeech: '명사',
        exampleTarget: 'Trabajo con mi portátil en el escritorio.',
        exampleKorean: '책상 위 노트북으로 작업해요.',
        phrase: 'portátil',
      },
    ],
    fr: [
      {
        word: 'Casque audio',
        reading: 'kask o-djo',
        koreanPronunciation: '카스크 오디오',
        meaning: '헤드폰',
        partOfSpeech: '명사',
        exampleTarget: 'J’écoute un podcast avec mon casque audio.',
        exampleKorean: '헤드폰으로 팟캐스트를 듣고 있어요.',
        phrase: 'casque audio',
      },
      {
        word: 'Ordinateur portable',
        reading: 'ɔʁ-di-na-tœʁ pɔʁ-tabl',
        koreanPronunciation: '오르디나퇴르 포르타블',
        meaning: '노트북',
        partOfSpeech: '명사구',
        exampleTarget: 'Mon ordinateur portable est sur le bureau.',
        exampleKorean: '제 노트북은 책상 위에 있어요.',
        phrase: 'ordinateur portable',
      },
    ],
    de: [
      {
        word: 'Kopfhörer',
        reading: 'KOPF-hö-rer',
        koreanPronunciation: '코프회러',
        meaning: '헤드폰',
        partOfSpeech: '남성명사 (der)',
        exampleTarget: 'Ich höre Musik mit meinen Kopfhörern.',
        exampleKorean: '헤드폰으로 음악을 들어요.',
        phrase: 'Kopfhörer',
      },
      {
        word: 'Laptop',
        reading: 'LEP-top',
        koreanPronunciation: '랩톱',
        meaning: '노트북',
        partOfSpeech: '남성명사 (der)',
        exampleTarget: 'Der Laptop liegt auf dem Schreibtisch.',
        exampleKorean: '노트북이 책상 위에 있어요.',
        phrase: 'der Laptop',
      },
    ],
    it: [
      {
        word: 'Cuffie',
        reading: 'KUF-fye',
        koreanPronunciation: '쿠피에',
        meaning: '헤드폰',
        partOfSpeech: '여성복수명사',
        exampleTarget: 'Metto le cuffie per studiare meglio.',
        exampleKorean: '집중해서 공부하려고 헤드폰을 써요.',
        phrase: 'le cuffie',
      },
      {
        word: 'Portatile',
        reading: 'por-TA-ti-le',
        koreanPronunciation: '포르타틸레',
        meaning: '노트북',
        partOfSpeech: '명사',
        exampleTarget: 'Il mio portatile è pronto sulla scrivania.',
        exampleKorean: '제 노트북이 책상 위에 준비되어 있어요.',
        phrase: 'il portatile',
      },
    ],
  },
};

export function runDemoTutor(params: {
  sceneId: DemoSceneId;
  language: TargetLanguageCode;
  persona: PersonaId;
  question?: string;
}): TutorResponsePayload {
  const pair = DEMO_CONTENT[params.sceneId][params.language];
  const [primary, secondary] = pair;
  const scene = DEMO_SCENES.find((s) => s.id === params.sceneId) ?? DEMO_SCENES[0];
  const personaName = PERSONAS[params.persona].koreanTitle;

  const prefixByPersona: Record<PersonaId, string> = {
    buddy: '오, 좋은 장면이네요! ',
    nerdy: '흥미로운 포인트예요! ',
    secret_agent: '현장 브리핑 들어갑니다. ',
    wizard: '오늘의 언어 주문을 외워볼까요? ',
  };

  return {
    userTranscript: params.question?.trim() || `📸 ${scene.title} 스캔`,
    replySegments: [
      { text: prefixByPersona[params.persona], isTarget: false },
      { text: '핵심 표현은 ', isTarget: false },
      { text: primary.word, isTarget: true },
      { text: `(${primary.meaning})예요. 실전에서는 `, isTarget: false },
      { text: primary.phrase, isTarget: true },
      { text: '라고 말하면 아주 자연스럽습니다! ', isTarget: false },
      { text: `(${personaName})`, isTarget: false },
    ],
    translationSummary: `${primary.word} = ${primary.meaning} · 예문: ${primary.exampleKorean}`,
    vocabCards: [
      {
        ...primary,
        box2d: scene.box2dPrimary,
      },
      {
        ...secondary,
        box2d: scene.box2dSecondary,
      },
    ],
  };
}

export async function generateStarterVocabCards(
  language: TargetLanguageCode,
): Promise<SavedVocabCard[]> {
  const starterScenes: DemoSceneId[] = ['cafe', 'ramen', 'station', 'desk'];
  const cards: SavedVocabCard[] = [];
  const now = Date.now();

  for (let i = 0; i < starterScenes.length; i++) {
    const sId = starterScenes[i];
    const sceneInfo = DEMO_SCENES.find((s) => s.id === sId)!;
    const imgUrl = renderDemoSceneDataUrl(sId);
    const [primary] = DEMO_CONTENT[sId][language];
    const stickerDataUrl = await createStickerDataUrlFromImage(imgUrl, sceneInfo.box2dPrimary, {
      shape: 'rounded',
      whiteBorder: true,
    });
    cards.push({
      id: `starter-${language}-${sId}-${now}-${i}`,
      language,
      word: primary.word,
      reading: primary.reading,
      koreanPronunciation: primary.koreanPronunciation,
      meaning: primary.meaning,
      partOfSpeech: primary.partOfSpeech,
      exampleTarget: primary.exampleTarget,
      exampleKorean: primary.exampleKorean,
      stickerDataUrl,
      sourceImageDataUrl: imgUrl,
      box2d: sceneInfo.box2dPrimary,
      stickerShape: 'rounded',
      whiteBorder: true,
      createdAt: now - i * 60000,
      reviewCount: 0,
    });
  }

  return cards;
}

export interface DemoConversationReply {
  userTranscript?: string;
  replyText: string;
  koreanTranslation: string;
  coachingTip?: CoachingTip;
  suggestedReplies: SuggestedReply[];
  vocabCards: ExtractedVocab[];
}

interface DemoDialogPreset {
  opening: Record<ProficiencyLevel, { reply: string; tr: string; hints: SuggestedReply[] }>;
  followUps: Array<{
    reply: string;
    tr: string;
    tip: CoachingTip;
    hints: SuggestedReply[];
    vocab: ExtractedVocab;
  }>;
}

const DEMO_CHAT_EN: Record<ConversationScenarioId, DemoDialogPreset> = {
  free_talk: {
    opening: {
      beginner: {
        reply: 'Hey! How is your day going today?',
        tr: '안녕! 오늘 하루 어떻게 보내고 있어?',
        hints: [
          { text: "It's going pretty well!", korean: '꽤 잘 보내고 있어요!' },
          { text: "I'm a bit tired today.", korean: '오늘은 조금 피곤해요.' },
        ],
      },
      intermediate: {
        reply: "Hey there! How's your week been treating you so far? Anything fun planned?",
        tr: '안녕! 이번 주는 지금까지 어땠어? 재미있는 계획 있어?',
        hints: [
          { text: 'Pretty busy, so I want to relax this weekend.', korean: '꽤 바빠서 이번 주말엔 쉬고 싶어요.' },
          { text: "I'm planning to check out a new cafe.", korean: '새 카페에 가볼 계획이에요.' },
        ],
      },
      advanced: {
        reply: "Hey! Long time no see—how have you been holding up lately? Anything exciting on your radar?",
        tr: '안녕! 오랜만이야, 요즘 어떻게 지냈어? 최근에 눈여겨보는 재밌는 일 있어?',
        hints: [
          { text: "Can't complain! I've been getting into photography lately.", korean: '나쁘지 않아! 요즘 사진 찍는 데 빠졌어.' },
          { text: "It's been hectic, to be honest, so I'm craving a getaway.", korean: '솔직히 정신없어서 어디론가 떠나고 싶어.' },
        ],
      },
    },
    followUps: [
      {
        reply: "That sounds nice! What do you usually like to do when you have some free time?",
        tr: '좋네요! 보통 시간 여유가 있을 땐 뭘 하면서 보내세요?',
        tip: {
          betterPhrase: 'In my free time, I usually unwind with music.',
          koreanNote: '"unwind"를 쓰면 "긴장을 풀며 쉬다"라는 자연스러운 원어민 뉘앙스가 살아요!',
        },
        hints: [
          { text: 'I usually watch movies or take a walk.', korean: '보통 영화를 보거나 산책해요.' },
          { text: 'I love trying out new restaurants.', korean: '맛집 탐방하는 걸 좋아해요.' },
        ],
        vocab: {
          word: 'unwind',
          reading: '/ʌnˈwaɪnd/',
          koreanPronunciation: '언와인드',
          meaning: '긴장을 풀다, 편히 쉬다',
          partOfSpeech: '회화 표현',
          exampleTarget: 'I like to unwind with a cup of tea.',
          exampleKorean: '차 한 잔 마시며 편히 쉬는 걸 좋아해요.',
        },
      },
      {
        reply: "Oh, I love that too! Have you done that recently, or is it something you're hoping to do soon?",
        tr: '오, 저도 그거 정말 좋아해요! 최근에 해보셨나요, 아니면 조만간 하실 예정인가요?',
        tip: {
          betterPhrase: "I haven't had the chance lately, but I'd love to soon.",
          koreanNote: '"haven\'t had the chance"는 "요즘 기회가 없었어요"라는 아주 실용적인 표현이에요.',
        },
        hints: [
          { text: 'I actually did it last weekend!', korean: '사실 지난 주말에 했어요!' },
          { text: "I'm hoping to do it this Saturday.", korean: '이번 토요일에 하려고 해요.' },
        ],
        vocab: {
          word: 'have the chance',
          reading: '/hæv ðə tʃæns/',
          koreanPronunciation: '해브 더 챈스',
          meaning: '~할 기회가 있다',
          partOfSpeech: '회화 표현',
          exampleTarget: "I hope you get the chance to visit.",
          exampleKorean: '꼭 방문해 볼 기회가 있길 바라요.',
        },
      },
    ],
  },
  cafe: {
    opening: {
      beginner: {
        reply: 'Hi! Welcome to our cafe. What can I get for you?',
        tr: '안녕하세요! 카페에 오신 걸 환영해요. 무엇으로 드릴까요?',
        hints: [
          { text: 'An iced latte, please.', korean: '아이스 라떼 한 잔 주세요.' },
          { text: 'What is your popular drink?', korean: '인기 있는 음료가 뭐예요?' },
        ],
      },
      intermediate: {
        reply: 'Welcome in! What can I get started for you today? Our seasonal vanilla latte is really popular.',
        tr: '어서 오세요! 오늘 어떤 음료로 준비해 드릴까요? 시즌 바닐라 라떼가 정말 인기 있어요.',
        hints: [
          { text: 'Could I get an iced oat latte, please?', korean: '아이스 오트 라떼로 주시겠어요?' },
          { text: "I'll try the seasonal vanilla latte, less sweet.", korean: '시즌 바닐라 라떼 덜 달게 마셔볼게요.' },
        ],
      },
      advanced: {
        reply: "Hey there, welcome in! Can I get you started with a coffee, or would you like a moment to look over our seasonal specials?",
        tr: '어서 오세요! 바로 커피부터 주문하시겠어요, 아니면 시즌 스페셜 메뉴를 조금 더 보시겠어요?',
        hints: [
          { text: "I'd love a cold brew with a splash of oat milk, for here.", korean: '오트 밀크 살짝 넣은 콜드브루로 먹고 갈게요.' },
          { text: 'Could you recommend something not overly sweet?', korean: '너무 달지 않은 메뉴로 추천해 주실래요?' },
        ],
      },
    },
    followUps: [
      {
        reply: 'Great choice! Would you like that for here or to go? Any milk preference?',
        tr: '좋은 선택이에요! 매장에서 드시겠어요, 포장해 드릴까요? 우유 변경도 가능해요.',
        tip: {
          betterPhrase: 'Could I have it to go with oat milk, please?',
          koreanNote: '테이크아웃은 "to go" 또는 "takeaway"라고 말하면 바로 통해요.',
        },
        hints: [
          { text: 'For here, please. Regular milk is fine.', korean: '먹고 갈게요. 일반 우유로 괜찮아요.' },
          { text: 'To go, please! Can I get less ice?', korean: '포장이요! 얼음 적게 주실 수 있나요?' },
        ],
        vocab: {
          word: 'for here or to go',
          reading: '/fɔːr hɪr ɔːr tə ɡoʊ/',
          koreanPronunciation: '포 히어 오어 투 고',
          meaning: '매장 식사인지 포장인지',
          partOfSpeech: '회화 표현',
          exampleTarget: 'I will have it to go, please.',
          exampleKorean: '포장으로 부탁드려요.',
        },
      },
    ],
  },
  travel: {
    opening: {
      beginner: {
        reply: 'Hello! Welcome to the hotel. Are you checking in?',
        tr: '안녕하세요! 호텔에 오신 걸 환영합니다. 체크인하시나요?',
        hints: [
          { text: 'Yes, I have a reservation.', korean: '네, 예약했어요.' },
          { text: 'Can I leave my bag here first?', korean: '가방을 먼저 맡길 수 있나요?' },
        ],
      },
      intermediate: {
        reply: 'Good afternoon! Welcome to Horizon Hotel. May I have your name for check-in?',
        tr: '안녕하세요! 호라이즌 호텔에 오신 걸 환영합니다. 체크인 성함을 알려주시겠어요?',
        hints: [
          { text: "Hi, I'm checking in under Kim. Is an early check-in possible?", korean: '안녕하세요, 김으로 예약했어요. 얼리 체크인 가능한가요?' },
          { text: 'Sure, here is my passport and booking confirmation.', korean: '네, 여기 여권과 예약 확인서예요.' },
        ],
      },
      advanced: {
        reply: "Good afternoon and welcome! I'd be happy to get you checked in—do you have your confirmation handy, or shall I look it up by name?",
        tr: '안녕하세요, 환영합니다! 체크인 도와드릴게요. 예약 확인서가 있으신가요, 아니면 성함으로 조회해 드릴까요?',
        hints: [
          { text: "Here's my passport. By any chance, is a higher-floor room available?", korean: '여기 여권이에요. 혹시 고층 객실로 가능할까요?' },
          { text: 'Could you also let me know what time breakfast starts?', korean: '조식 시작 시간도 알려주시겠어요?' },
        ],
      },
    },
    followUps: [
      {
        reply: 'All set! Here is your key card for room 804. Do you need directions to the elevator or any local tips?',
        tr: '모두 완료됐습니다! 804호 키 카드입니다. 엘리베이터 위치나 주변 맛집 추천이 필요하신가요?',
        tip: {
          betterPhrase: 'Could you recommend a good restaurant nearby?',
          koreanNote: '주변 추천을 물을 땐 "nearby"를 문장 끝에 붙이면 아주 자연스러워요.',
        },
        hints: [
          { text: 'Yes, any good local restaurants nearby?', korean: '네, 근처에 현지 맛집 있나요?' },
          { text: 'What is the Wi-Fi password?', korean: '와이파이 비밀번호가 뭔가요?' },
        ],
        vocab: {
          word: 'check in',
          reading: '/tʃek ɪn/',
          koreanPronunciation: '체크 인',
          meaning: '체크인하다, 투숙 등록하다',
          partOfSpeech: '회화 표현',
          exampleTarget: "I'd like to check in, please.",
          exampleKorean: '체크인하고 싶습니다.',
        },
      },
    ],
  },
  restaurant: {
    opening: {
      beginner: {
        reply: 'Hello! Table for how many people today?',
        tr: '안녕하세요! 오늘 몇 분이신가요?',
        hints: [
          { text: 'Table for two, please.', korean: '두 명 자리 부탁해요.' },
          { text: 'Just one person, please.', korean: '혼자예요.' },
        ],
      },
      intermediate: {
        reply: 'Welcome! Do you have a reservation, or would you like a table by the window?',
        tr: '어서 오세요! 예약하셨나요, 아니면 창가 자리로 안내해 드릴까요?',
        hints: [
          { text: 'No reservation, a window seat would be lovely!', korean: '예약은 안 했는데 창가 자리면 좋겠어요!' },
          { text: 'Could we see the menu and start with some water?', korean: '메뉴판 주시고 물 먼저 부탁드릴게요.' },
        ],
      },
      advanced: {
        reply: "Good evening! Welcome in—we have a cozy booth or a patio table open. Which would you prefer, and can I bring you a drink while you browse?",
        tr: '안녕하세요! 아늑한 부스석과 테라스 자리가 비어 있는데 어디가 좋으실까요? 메뉴 보시는 동안 음료 먼저 드릴까요?',
        hints: [
          { text: 'The patio sounds wonderful! Could you tell us your signature dish?', korean: '테라스 좋네요! 이곳 시그니처 메뉴가 뭔가요?' },
          { text: "We'll take the booth. Also, I'm allergic to peanuts.", korean: '부스석으로 할게요. 그리고 제가 땅콩 알레르기가 있어요.' },
        ],
      },
    },
    followUps: [
      {
        reply: 'Right away! Our house pasta is a crowd favorite. Are you ready to order, or do you need a few more minutes?',
        tr: '바로 준비해 드릴게요! 저희 하우스 파스타가 인기 최고예요. 지금 주문하시겠어요, 아니면 조금 더 보시겠어요?',
        tip: {
          betterPhrase: 'Could we have a couple more minutes, please?',
          koreanNote: '조금 더 고민할 땐 "a couple more minutes"라고 하면 정중하고 자연스러워요.',
        },
        hints: [
          { text: "I'll have the house pasta, please.", korean: '하우스 파스타로 할게요.' },
          { text: 'Could we have a few more minutes?', korean: '몇 분만 더 봐도 될까요?' },
        ],
        vocab: {
          word: 'crowd favorite',
          reading: '/kraʊd ˈfeɪvərɪt/',
          koreanPronunciation: '크라우드 페이버릿',
          meaning: '모두가 좋아하는 인기 메뉴',
          partOfSpeech: '회화 표현',
          exampleTarget: 'The tiramisu here is a crowd favorite.',
          exampleKorean: '여기 티라미수가 인기 메뉴예요.',
        },
      },
    ],
  },
  business: {
    opening: {
      beginner: {
        reply: 'Nice to meet you! Could you tell me a little about yourself?',
        tr: '만나서 반갑습니다! 간단히 자기소개를 해주실 수 있나요?',
        hints: [
          { text: "Hi, I'm a product designer from Korea.", korean: '안녕하세요, 한국에서 온 프로덕트 디자이너예요.' },
          { text: "Nice to meet you! I work in IT.", korean: '반갑습니다! 저는 IT 분야에서 일하고 있어요.' },
        ],
      },
      intermediate: {
        reply: 'Thanks for joining today! Before we dive in, could you briefly walk me through your current role?',
        tr: '오늘 함께해 주셔서 감사합니다! 시작하기 전에 현재 맡고 계신 역할을 간단히 설명해 주실래요?',
        hints: [
          { text: 'Sure! I lead a small team working on mobile apps.', korean: '네! 모바일 앱을 만드는 작은 팀을 이끌고 있어요.' },
          { text: "I'm currently focused on growing our global product.", korean: '현재 글로벌 서비스 성장에 집중하고 있어요.' },
        ],
      },
      advanced: {
        reply: "Great to connect with you today! To kick things off, what's been the most rewarding project you've tackled recently?",
        tr: '오늘 뵙게 되어 반갑습니다! 먼저 최근 진행하신 프로젝트 중 가장 보람찼던 일은 무엇인가요?',
        hints: [
          { text: 'Recently, I spearheaded a product launch that cut latency in half.', korean: '최근 응답 속도를 절반으로 줄인 제품 출시를 주도했어요.' },
          { text: 'I really enjoyed collaborating across teams to revamp our UX.', korean: '여러 팀과 협업해 UX를 개편한 작업이 정말 뜻깊었어요.' },
        ],
      },
    },
    followUps: [
      {
        reply: "That sounds impressive! What's one big goal you're aiming for over the next few months?",
        tr: '정말 인상적이네요! 앞으로 몇 달 동안 목표로 삼고 있는 큰 계획이 있으신가요?',
        tip: {
          betterPhrase: "My main priority right now is sharpening my communication skills.",
          koreanNote: '업무 목표를 말할 땐 "My main priority is~"로 시작하면 프로페셔널해 보여요.',
        },
        hints: [
          { text: 'I want to communicate more smoothly with global clients.', korean: '글로벌 고객과 더 매끄럽게 소통하고 싶어요.' },
          { text: 'My priority is launching our next major update.', korean: '다음 대규모 업데이트를 성공적으로 출시하는 게 목표예요.' },
        ],
        vocab: {
          word: 'walk someone through',
          reading: '/wɔːk θruː/',
          koreanPronunciation: '워크 쓰루',
          meaning: '차근차근 설명하다',
          partOfSpeech: '회화 표현',
          exampleTarget: 'Let me walk you through the plan.',
          exampleKorean: '계획을 차근차근 설명해 드릴게요.',
        },
      },
    ],
  },
  custom: {
    opening: {
      beginner: {
        reply: "Let's practice this topic together! What would you like to say first?",
        tr: '이 주제로 같이 연습해 봐요! 먼저 어떤 말로 시작해 볼까요?',
        hints: [
          { text: 'Hi! Can you help me with something?', korean: '안녕하세요! 좀 도와주실 수 있나요?' },
          { text: 'I want to practice everyday expressions.', korean: '일상 표현을 연습하고 싶어요.' },
        ],
      },
      intermediate: {
        reply: "Awesome topic! Let's jump right into the roleplay—how would you kick off the conversation?",
        tr: '멋진 주제네요! 바로 상황극 시작해 볼까요? 어떻게 첫 마디를 꺼내시겠어요?',
        hints: [
          { text: 'Excuse me, do you have a minute?', korean: '실례지만 잠깐 시간 괜찮으세요?' },
          { text: "Hi! I'd love to talk about this topic.", korean: '안녕하세요! 이 주제로 이야기해 보고 싶어요.' },
        ],
      },
      advanced: {
        reply: "Love that scenario—I'm fully in character! Go ahead and set the stage however you'd like.",
        tr: '정말 좋은 시나리오예요, 바로 몰입할게요! 원하시는 대로 먼저 상황을 열어 주세요.',
        hints: [
          { text: "Thanks for making time—I wanted to discuss something important.", korean: '시간 내주셔서 감사해요, 중요한 이야기를 나누고 싶었어요.' },
          { text: 'Hey, I was curious about your take on this.', korean: '안녕, 이 문제에 대한 네 생각이 궁금했어.' },
        ],
      },
    },
    followUps: [
      {
        reply: 'Nice start! Could you tell me a bit more about what you have in mind?',
        tr: '좋은 시작이에요! 생각하고 계신 걸 조금 더 자세히 말씀해 주실래요?',
        tip: {
          betterPhrase: "What I have in mind is something simple and practical.",
          koreanNote: '"have in mind"는 "염두에 두다, 생각하고 있다"라는 유용한 회화 표현이에요.',
        },
        hints: [
          { text: "Sure, here's what I'm thinking...", korean: '네, 제가 생각하는 건...' },
          { text: 'Could you give me a recommendation?', korean: '추천 좀 해주시겠어요?' },
        ],
        vocab: {
          word: 'have in mind',
          reading: '/hæv ɪn maɪnd/',
          koreanPronunciation: '해브 인 마인드',
          meaning: '염두에 두다, 생각해 두다',
          partOfSpeech: '회화 표현',
          exampleTarget: 'Do you have a place in mind for dinner?',
          exampleKorean: '저녁 먹을 곳 생각해 둔 데 있어요?',
        },
      },
    ],
  },
};

const DEMO_JA_OPENING: Record<ConversationScenarioId, { reply: string; tr: string; hints: SuggestedReply[] }> = {
  free_talk: {
    reply: 'こんにちは！今日はどんな一日でしたか？',
    tr: '안녕하세요! 오늘은 어떤 하루였나요?',
    hints: [
      { text: 'とても楽しかったです！', korean: '정말 즐거웠어요!' },
      { text: 'ちょっと忙しかったです。', korean: '조금 바빴어요.' },
    ],
  },
  cafe: {
    reply: 'いらっしゃいませ！ご注文はお決まりですか？',
    tr: '어서 오세요! 주문은 결정하셨나요?',
    hints: [
      { text: 'アイスラテを一つお願いします。', korean: '아이스 라떼 한 잔 부탁드려요.' },
      { text: 'おすすめは何ですか？', korean: '추천 메뉴가 뭐예요?' },
    ],
  },
  travel: {
    reply: 'いらっしゃいませ。チェックインでしょうか？',
    tr: '어서 오세요. 체크인이신가요?',
    hints: [
      { text: 'はい、予約しています。', korean: '네, 예약했습니다.' },
      { text: '荷物を預けられますか？', korean: '짐을 맡길 수 있나요?' },
    ],
  },
  restaurant: {
    reply: 'いらっしゃいませ！何名様でしょうか？',
    tr: '어서 오세요! 몇 분이신가요?',
    hints: [
      { text: '二人です。', korean: '두 명이에요.' },
      { text: 'メニューを見せてください。', korean: '메뉴판 좀 보여주세요.' },
    ],
  },
  business: {
    reply: 'はじめまして！簡単に自己紹介をお願いできますか？',
    tr: '처음 뵙겠습니다! 간단히 자기소개 부탁드릴까요?',
    hints: [
      { text: '韓国から来ました。ITの仕事をしています。', korean: '한국에서 왔습니다. IT 일을 하고 있어요.' },
      { text: 'よろしくお願いします！', korean: '잘 부탁드립니다!' },
    ],
  },
  custom: {
    reply: 'いいテーマですね！さっそく話してみましょう。',
    tr: '좋은 주제네요! 바로 이야기해 볼까요?',
    hints: [
      { text: 'すみません、少し聞いてもいいですか？', korean: '실례지만 잠깐 여쭤봐도 될까요?' },
      { text: '自然な表現を練習したいです。', korean: '자연스러운 표현을 연습하고 싶어요.' },
    ],
  },
};

export function runDemoConversationTurn(params: {
  scenarioId: ConversationScenarioId;
  language: TargetLanguageCode;
  level: ProficiencyLevel;
  turnCount: number;
  userText?: string;
  isOpening?: boolean;
}): DemoConversationReply {
  const { scenarioId, language, level, turnCount, userText, isOpening } = params;

  if (language === 'ja') {
    if (isOpening) {
      const ja = DEMO_JA_OPENING[scenarioId];
      return {
        replyText: ja.reply,
        koreanTranslation: ja.tr,
        suggestedReplies: ja.hints,
        vocabCards: [],
      };
    }
    return {
      userTranscript: userText || '🎙️ 음성 답변',
      replyText: 'いいですね！もう少し詳しく教えてくれますか？',
      koreanTranslation: '좋네요! 조금 더 자세히 알려주실래요?',
      coachingTip: {
        betterPhrase: 'とてもよかったです！',
        koreanNote: '정중하고 밝게 반응할 때 "とてもよかったです"를 쓰면 자연스러워요.',
      },
      suggestedReplies: [
        { text: 'もちろんです！', korean: '물론이죠!' },
        { text: 'おすすめを教えてください。', korean: '추천 좀 해주세요.' },
      ],
      vocabCards: [
        {
          word: 'もう少し詳しく',
          reading: 'もうすこしくわしく (mō sukoshi kuwashiku)',
          koreanPronunciation: '모오 스코시 쿠와시쿠',
          meaning: '조금 더 자세히',
          partOfSpeech: '회화 표현',
          exampleTarget: 'もう少し詳しく教えてください。',
          exampleKorean: '조금 더 자세히 알려주세요.',
        },
      ],
    };
  }

  const preset = DEMO_CHAT_EN[scenarioId];
  if (isOpening) {
    const opener = preset.opening[level];
    return {
      replyText: opener.reply,
      koreanTranslation: opener.tr,
      suggestedReplies: opener.hints,
      vocabCards: [],
    };
  }

  const follow = preset.followUps[turnCount % preset.followUps.length];
  return {
    userTranscript: userText || '🎙️ 음성 답변',
    replyText: follow.reply,
    koreanTranslation: follow.tr,
    coachingTip: follow.tip,
    suggestedReplies: follow.hints,
    vocabCards: [follow.vocab],
  };
}
