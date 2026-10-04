import { describe, expect, it } from 'vitest';
import { detectQuestion, looksLikeQuestion } from '../src/shared/suggest/question-detector.ts';

describe('detectQuestion', () => {
  it.each([
    // Question mark
    ['Premium monthly hai ya yearly?', 'question-mark'],
    ['Is it refundable ?"', 'question-mark'],
    // English question words
    ['what is the claim settlement ratio', 'question-word'],
    ['so how does the rider work', 'question-word'],
    // Hinglish
    ['Premium kitna hoga monthly', 'question-word'],
    ['aap kab call back karenge', 'question-word'],
    ['yeh plan kaise kaam karta hai', 'question-word'],
    ['kyun itna mehenga hai', 'question-word'],
    ['kaun sa plan best rahega', 'question-word'],
    ['Kya isme tax benefit milta hai', 'question-word'],
    ['delivery kidhar hogi', 'question-word'],
    // Hindi Devanagari
    ['प्रीमियम कितना होगा', 'question-word'],
    ['आप कब तक भेज देंगे', 'question-word'],
    ['यह पॉलिसी क्यों लूँ', 'question-word'],
    ['क्या इसमें टैक्स बेनिफिट है', 'question-word'],
    // Tanglish / Tamil
    ['indha plan evlo aagum', 'question-word'],
    ['இது எவ்வளவு', 'question-word'],
    // English auxiliaries at the start
    ['can you send me the brochure', 'leading-auxiliary'],
    ['do you have a cheaper option', 'leading-auxiliary'],
    // Tag questions
    ['matlab cover pura family ka hai na', 'tag'],
    ['that includes GST right', 'tag'],
  ])('%s → question (%s)', (text, reason) => {
    expect(detectQuestion(text)).toMatchObject({ isQuestion: true, reason });
  });

  it.each([
    'Theek hai, main kal call karta hoon.',
    'okay sounds good',
    'मैं कल फ़ोन करूँगा',
    'Kya baat hai, bahut badhiya',
    'what a great plan',
    'I can send it tomorrow',
    'na',
    '',
    '   ',
  ])('%j → not a question', (text) => {
    expect(looksLikeQuestion(text)).toBe(false);
  });

  it('reports the matched token', () => {
    expect(detectQuestion('EMI kitni banegi').matched).toBe('kitni');
  });
});
