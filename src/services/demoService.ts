import { PERSONAS } from '../config/personas';
import { createStickerDataUrlFromImage } from '../lib/bboxCrop';
import type {
  Box2D,
  PersonaId,
  SavedVocabCard,
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
