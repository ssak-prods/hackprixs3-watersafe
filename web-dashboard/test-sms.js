import { updateSMSState, getSMSState } from './sms.js';

async function runTests() {
  console.log('=== STARTING SMS STATE MACHINE TESTS ===');

  // Test Case 1: SAFE stays SAFE with safe readings
  console.log('\n--- Test 1: SAFE with Safe Readings ---');
  await updateSMSState(0, 'Normal'); // Safe
  console.log('Current State:', getSMSState(), '(Expected: SAFE)');

  // Test Case 2: SAFE -> WARN_PENDING with 1st unsafe reading
  console.log('\n--- Test 2: SAFE -> WARN_PENDING (1st Unsafe) ---');
  await updateSMSState(2, 'Caution: Turbidity spike'); // Unsafe
  console.log('Current State:', getSMSState(), '(Expected: WARN_PENDING)');

  // Test Case 3: WARN_PENDING -> SAFE if reading becomes safe again (noise filter)
  console.log('\n--- Test 3: WARN_PENDING -> SAFE (Noise recovery) ---');
  await updateSMSState(1, 'Uncertain'); // Safe
  console.log('Current State:', getSMSState(), '(Expected: SAFE)');

  // Test Case 4: SAFE -> WARN_PENDING (1st Unsafe) -> WARN_PENDING (2nd Unsafe) -> ALARMING (3rd Unsafe)
  console.log('\n--- Test 4: SAFE -> WARN_PENDING (1, 2) -> ALARMING (3) ---');
  await updateSMSState(2, 'Caution'); // 1st Unsafe
  console.log('Current State (1):', getSMSState(), '(Expected: WARN_PENDING)');
  await updateSMSState(3, 'Warning'); // 2nd Unsafe
  console.log('Current State (2):', getSMSState(), '(Expected: WARN_PENDING)');
  await updateSMSState(4, 'Critical: Contamination'); // 3rd Unsafe
  console.log('Current State (3):', getSMSState(), '(Expected: ALARMING)');

  // Test Case 5: ALARMING -> CLEAR_PENDING (1st Safe) -> CLEAR_PENDING (2nd Safe) -> SAFE (3rd Safe)
  console.log('\n--- Test 5: ALARMING -> CLEAR_PENDING (1, 2) -> SAFE (3) ---');
  await updateSMSState(0, 'Normal'); // 1st Safe
  console.log('Current State (1):', getSMSState(), '(Expected: CLEAR_PENDING)');
  await updateSMSState(1, 'Uncertain'); // 2nd Safe
  console.log('Current State (2):', getSMSState(), '(Expected: CLEAR_PENDING)');
  await updateSMSState(0, 'Normal'); // 3rd Safe
  console.log('Current State (3):', getSMSState(), '(Expected: SAFE)');

  // Test Case 6: ALARMING -> CLEAR_PENDING (1st Safe) -> Relapse to ALARMING
  console.log('\n--- Test 6: ALARMING -> CLEAR_PENDING -> Relapse to ALARMING ---');
  // Trigger alarm first
  await updateSMSState(3, 'Unsafe'); // 1st
  await updateSMSState(3, 'Unsafe'); // 2nd
  await updateSMSState(3, 'Unsafe'); // 3rd -> ALARMING
  console.log('Triggered alarm. Current State:', getSMSState(), '(Expected: ALARMING)');
  
  await updateSMSState(0, 'Safe'); // 1st Safe -> CLEAR_PENDING
  console.log('Current State (1):', getSMSState(), '(Expected: CLEAR_PENDING)');
  
  await updateSMSState(2, 'Unsafe again'); // Relapse -> ALARMING
  console.log('Current State (2):', getSMSState(), '(Expected: ALARMING)');

  console.log('\n=== ALL TESTS COMPLETED ===');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
});
