import type { ConversationScenarioId } from '../types/app';

export interface ConversationScenarioConfig {
  id: ConversationScenarioId;
  emoji: string;
  title: string;
  subtitle: string;
  accentColor: string;
  aiRolePrompt: string;
  openingGoalPrompt: string;
}

export const CONVERSATION_SCENARIOS: Record<ConversationScenarioId, ConversationScenarioConfig> = {
  free_talk: {
    id: 'free_talk',
    emoji: '🗣️',
    title: '자유 프리토킹',
    subtitle: '일상·취미·오늘 있었던 일 편하게 수다',
    accentColor: '#38BDF8',
    aiRolePrompt: 'a warm local friend having a casual everyday chat about daily life, hobbies, food, or weekend plans',
    openingGoalPrompt: 'Greet the learner warmly and ask one light, easy-to-answer question about their day or plans.',
  },
  cafe: {
    id: 'cafe',
    emoji: '☕',
    title: '카페 주문',
    subtitle: '음료 커스텀·디저트 추천·자리 묻기',
    accentColor: '#F59E0B',
    aiRolePrompt: 'a friendly barista working at a cozy local cafe',
    openingGoalPrompt: 'Welcome the customer to the cafe and ask what they would like to order today.',
  },
  travel: {
    id: 'travel',
    emoji: '✈️',
    title: '여행 · 공항 · 호텔',
    subtitle: '체크인·길 묻기·교통 티켓 해결하기',
    accentColor: '#34D399',
    aiRolePrompt: 'a helpful hotel receptionist or travel information desk staff member assisting a traveler',
    openingGoalPrompt: 'Greet the traveler warmly at the desk and ask how you can help with their check-in or trip.',
  },
  restaurant: {
    id: 'restaurant',
    emoji: '🍽️',
    title: '레스토랑 식사',
    subtitle: '메뉴 추천·알레르기 요청·계산하기',
    accentColor: '#FB7185',
    aiRolePrompt: 'an attentive server at a popular local restaurant',
    openingGoalPrompt: 'Welcome the guest to the table and ask about seating, drinks, or if they want menu recommendations.',
  },
  business: {
    id: 'business',
    emoji: '💼',
    title: '비즈니스 · 면접',
    subtitle: '자기소개·업무 스몰톡·정중한 미팅 표현',
    accentColor: '#A78BFA',
    aiRolePrompt: 'a polite international colleague or interviewer in a friendly professional meeting',
    openingGoalPrompt: 'Greet the learner professionally and ask them to briefly introduce themselves or their current work.',
  },
  custom: {
    id: 'custom',
    emoji: '✏️',
    title: '직접 주제 입력',
    subtitle: '원하는 상황이나 주제를 자유롭게 설정',
    accentColor: '#2DD4BF',
    aiRolePrompt: 'an engaging conversation partner playing the requested custom scenario naturally',
    openingGoalPrompt: 'Start the conversation naturally in character for the custom topic with one inviting question.',
  },
};

export const SCENARIO_PRESET_LIST: ConversationScenarioConfig[] = [
  CONVERSATION_SCENARIOS.free_talk,
  CONVERSATION_SCENARIOS.cafe,
  CONVERSATION_SCENARIOS.travel,
  CONVERSATION_SCENARIOS.restaurant,
  CONVERSATION_SCENARIOS.business,
];
