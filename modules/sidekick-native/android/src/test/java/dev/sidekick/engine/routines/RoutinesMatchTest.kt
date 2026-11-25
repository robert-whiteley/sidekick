package dev.sidekick.engine.routines

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as messageMatches in __tests__/routines-logic-test.ts. */
class RoutinesMatchTest {
  @Test
  fun matchesSenderAndApp() {
    assertTrue(Routines.matches("Sam", "whatsapp", "Sam Taylor", "WhatsApp", "com.whatsapp"))
    assertFalse(Routines.matches("Sam", "whatsapp", "Samantha", "WhatsApp", "com.whatsapp"))
    assertFalse(Routines.matches("Sam", "whatsapp", "Sam", "Messages", "com.google.android.apps.messaging"))
    assertTrue(Routines.matches(null, "sms", "Jo", "Messages", "x"))
    assertTrue(Routines.matches(null, null, "Anyone", null, null))
  }
}
