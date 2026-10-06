package ru.pivnik.evotor.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class BindingPolicyTest {
    private static final String RECEIPT_A = "11111111-aaaa-4aaa-8aaa-111111111111";
    private static final String RECEIPT_B = "22222222-bbbb-4bbb-8bbb-222222222222";
    private static final ResolvedClient KIRILL = new ResolvedClient("101", "Кирилл");
    private static final ResolvedClient ANNA = new ResolvedClient("202", "Анна");

    private final MemoryBindingStore store = new MemoryBindingStore();
    private final BindingPolicy policy = new BindingPolicy(store);

    @Test
    public void validCodeOnOpenReceiptBindsThatReceiptOnly() {
        assertEquals(BindingPolicy.Outcome.BOUND, policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, KIRILL, 1_000));
        ReceiptBinding binding = policy.bindingFor(RECEIPT_A, 2_000);
        assertNotNull(binding);
        assertEquals("101", binding.userId);
        assertNull("a binding must never answer for another receipt", policy.bindingFor(RECEIPT_B, 2_000));
    }

    @Test
    public void receiptChangingDuringLookupBindsNothing() {
        assertEquals(BindingPolicy.Outcome.RECEIPT_CHANGED, policy.onCustomerResolved(RECEIPT_A, RECEIPT_B, KIRILL, 1_000));
        assertEquals(BindingPolicy.Outcome.RECEIPT_CHANGED, policy.onCustomerResolved(RECEIPT_A, null, KIRILL, 1_000));
        assertNull(policy.bindingFor(RECEIPT_A, 1_000));
        assertNull(policy.bindingFor(RECEIPT_B, 1_000));
    }

    @Test
    public void sameCustomerScannedTwiceIsANoOp() {
        policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, KIRILL, 1_000);
        assertEquals(BindingPolicy.Outcome.ALREADY_BOUND, policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, KIRILL, 5_000));
        assertEquals(1_000, policy.bindingFor(RECEIPT_A, 6_000).boundAtMillis);
    }

    @Test
    public void secondCustomerNeedsAConfirmingSecondScan() {
        policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, KIRILL, 1_000);
        assertEquals(BindingPolicy.Outcome.REPLACE_NEEDS_CONFIRMATION,
                policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, ANNA, 2_000));
        assertEquals("101", policy.bindingFor(RECEIPT_A, 2_500).userId);
        assertEquals(BindingPolicy.Outcome.REPLACED,
                policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, ANNA, 2_000 + BindingPolicy.REPLACE_CONFIRM_WINDOW_MS));
        assertEquals("202", policy.bindingFor(RECEIPT_A, 30_000).userId);
    }

    @Test
    public void lateConfirmationDoesNotReplace() {
        policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, KIRILL, 1_000);
        policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, ANNA, 2_000);
        assertEquals(BindingPolicy.Outcome.REPLACE_NEEDS_CONFIRMATION,
                policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, ANNA, 2_001 + BindingPolicy.REPLACE_CONFIRM_WINDOW_MS));
        assertEquals("101", policy.bindingFor(RECEIPT_A, 40_000).userId);
    }

    @Test
    public void scanningTheOriginalCustomerCancelsAPendingReplacement() {
        policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, KIRILL, 1_000);
        policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, ANNA, 2_000);
        policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, KIRILL, 3_000);
        assertEquals(BindingPolicy.Outcome.REPLACE_NEEDS_CONFIRMATION,
                policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, ANNA, 4_000));
        assertEquals("101", policy.bindingFor(RECEIPT_A, 4_500).userId);
    }

    @Test
    public void deletedReceiptDoesNotPassItsCustomerOn() {
        policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, KIRILL, 1_000);
        policy.onReceiptFinished(RECEIPT_A);
        assertNull(policy.bindingFor(RECEIPT_A, 2_000));
        policy.onReceiptOpened(RECEIPT_B);
        assertNull(policy.bindingFor(RECEIPT_B, 2_000));
        assertNull(policy.storedBinding());
    }

    @Test
    public void closingOneReceiptLeavesTheNextOneClean() {
        policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, KIRILL, 1_000);
        policy.onReceiptFinished(RECEIPT_B); // another receipt's close must not touch A
        assertNotNull(policy.bindingFor(RECEIPT_A, 1_500));
        policy.onReceiptFinished(RECEIPT_A);
        assertNull(policy.bindingFor(RECEIPT_B, 2_000));
        assertNull(policy.storedBinding());
    }

    @Test
    public void openingANewReceiptDropsAStaleBindingEvenWithoutAClosedEvent() {
        policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, KIRILL, 1_000);
        policy.onReceiptOpened(RECEIPT_B);
        assertNull(policy.bindingFor(RECEIPT_A, 2_000));
        assertNull(policy.bindingFor(RECEIPT_B, 2_000));
    }

    @Test
    public void reopeningTheSameReceiptKeepsItsCustomer() {
        policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, KIRILL, 1_000);
        policy.onReceiptOpened(RECEIPT_A);
        assertNotNull(policy.bindingFor(RECEIPT_A, 2_000));
    }

    @Test
    public void bindingSurvivesAProcessRestartButExpires() {
        policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, KIRILL, 1_000);
        BindingPolicy afterRestart = new BindingPolicy(store);
        assertNotNull(afterRestart.bindingFor(RECEIPT_A, 1_000 + BindingPolicy.TTL_MS));
        assertNull(afterRestart.bindingFor(RECEIPT_A, 1_001 + BindingPolicy.TTL_MS));
        assertNull(store.loadBinding());
    }

    @Test
    public void clockGoingBackwardsIsTreatedAsExpired() {
        policy.onCustomerResolved(RECEIPT_A, RECEIPT_A, KIRILL, 10_000);
        assertNull(policy.bindingFor(RECEIPT_A, 9_000));
    }

    @Test(expected = IllegalArgumentException.class)
    public void clientIdMustBeServerIssuedNumericId() {
        new ResolvedClient("PIVNIK:abc", "x");
    }
}
