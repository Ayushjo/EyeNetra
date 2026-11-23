"""Run: .venv/bin/python -m pytest test_speech_text.py -q"""

from speech_text import hindi_number, normalise_for_speech, rupees


def test_irregular_table():
    assert hindi_number(0) == "शून्य"
    assert hindi_number(19) == "उन्नीस"
    assert hindi_number(45) == "पैंतालीस"
    assert hindi_number(99) == "निन्यानवे"


def test_indian_system():
    assert hindi_number(100) == "एक सौ"
    assert hindi_number(800) == "आठ सौ"
    assert hindi_number(2499) == "दो हज़ार चार सौ निन्यानवे"
    assert hindi_number(12000) == "बारह हज़ार"
    assert hindi_number(150000) == "एक लाख पचास हज़ार"


def test_round_hundreds_shop_style():
    assert hindi_number(1500) == "पंद्रह सौ"
    assert hindi_number(1100) == "ग्यारह सौ"
    assert hindi_number(1550) == "एक हज़ार पाँच सौ पचास"
    assert hindi_number(2000) == "दो हज़ार"


def test_same_input_same_output():
    assert rupees(2499) == rupees(2499) == "दो हज़ार चार सौ निन्यानवे रुपये"


def test_normalise_prices_and_skus():
    assert normalise_for_speech("यह ₹2,499 का है") == "यह दो हज़ार चार सौ निन्यानवे रुपये का है"
    assert normalise_for_speech("Rs. 800 rupees") == "आठ सौ रुपये"
    assert normalise_for_speech("EN-1041 वाला फ्रेम") == "वाला फ्रेम"
    assert normalise_for_speech("बजट 3000 है") == "बजट तीन हज़ार है"
    # Model names with digits stay untouched.
    assert "B307" in normalise_for_speech("Sport B307")
