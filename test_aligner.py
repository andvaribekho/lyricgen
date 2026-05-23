#!/usr/bin/env python3
import unittest
import difflib
from aligner import parse_lyrics, normalize_word

class TestLyricAligner(unittest.TestCase):
    def test_normalization(self):
        self.assertEqual(normalize_word("Hola,"), "hola")
        self.assertEqual(normalize_word("¿Cómo?"), "como")
        self.assertEqual(normalize_word("estás!"), "estas")
        self.assertEqual(normalize_word("niño"), "nino")

    def test_lyrics_parsing(self):
        lyrics = "Hola, ¿cómo estás?\n\nYo estoy muy bien."
        parsed = parse_lyrics(lyrics)
        
        self.assertEqual(len(parsed), 7)
        self.assertEqual(parsed[0]["word"], "Hola,")
        self.assertEqual(parsed[0]["normalized"], "hola")
        self.assertEqual(parsed[0]["phrase"], "Hola, ¿cómo estás?")
        self.assertEqual(parsed[4]["word"], "estoy")
        self.assertEqual(parsed[4]["phrase"], "Yo estoy muy bien.")

    def test_alignment_and_interpolation(self):
        # 1. Parse target lyrics
        lyrics = "Hola, ¿cómo estás?\nYo estoy muy bien."
        lyrics_words = parse_lyrics(lyrics)
        
        # 2. Mock Whisper transcribed words (Note: Whisper misheard/missed "muy" in this mock data!)
        mock_transcribed = [
            {"word": "Hola", "normalized": "hola", "start": 1.0, "end": 1.5},
            {"word": "como", "normalized": "como", "start": 1.5, "end": 2.0},
            {"word": "estas", "normalized": "estas", "start": 2.0, "end": 2.5},
            {"word": "yo", "normalized": "yo", "start": 3.5, "end": 4.0},
            {"word": "estoy", "normalized": "estoy", "start": 4.0, "end": 4.5},
            # "muy" is missing here!
            {"word": "bien", "normalized": "bien", "start": 5.5, "end": 6.0}
        ]

        # 3. Perform Sequence Matching
        lyrics_norm = [w["normalized"] for w in lyrics_words]
        trans_norm = [w["normalized"] for w in mock_transcribed]
        
        matcher = difflib.SequenceMatcher(None, lyrics_norm, trans_norm)
        matching_blocks = matcher.get_matching_blocks()
        
        for w in lyrics_words:
            w["start"] = None
            w["end"] = None
            
        for block in matching_blocks:
            a, b, size = block.a, block.b, block.size
            for i in range(size):
                lyrics_words[a + i]["start"] = mock_transcribed[b + i]["start"]
                lyrics_words[a + i]["end"] = mock_transcribed[b + i]["end"]

        # Verify matches
        self.assertEqual(lyrics_words[0]["start"], 1.0) # Hola
        self.assertEqual(lyrics_words[1]["start"], 1.5) # ¿cómo
        self.assertEqual(lyrics_words[2]["start"], 2.0) # estás?
        self.assertEqual(lyrics_words[3]["start"], 3.5) # Yo
        self.assertEqual(lyrics_words[4]["start"], 4.0) # estoy
        self.assertIsNone(lyrics_words[5]["start"])       # muy (missing, should be None)
        self.assertEqual(lyrics_words[6]["start"], 5.5) # bien.

        # 4. Perform Linear Interpolation (mimics the logic inside aligner.py)
        n_words = len(lyrics_words)
        total_duration = 7.0
        
        def find_next_matched(start_idx):
            for idx in range(start_idx, n_words):
                if lyrics_words[idx]["start"] is not None:
                    return idx
            return None

        last_end = 0.0
        idx = 0
        while idx < n_words:
            if lyrics_words[idx]["start"] is not None:
                last_end = lyrics_words[idx]["end"]
                idx += 1
                continue
                
            gap_start_idx = idx
            gap_end_idx = find_next_matched(idx)
            
            if gap_end_idx is None:
                gap_words_count = n_words - gap_start_idx
                end_bound = max(total_duration, last_end + gap_words_count * 0.5)
                gap_duration = end_bound - last_end
                step = gap_duration / (gap_words_count + 1)
                for i in range(gap_words_count):
                    cur_idx = gap_start_idx + i
                    lyrics_words[cur_idx]["start"] = last_end + i * step
                    lyrics_words[cur_idx]["end"] = last_end + (i + 1) * step
                break
            else:
                gap_words_count = gap_end_idx - gap_start_idx
                next_start = lyrics_words[gap_end_idx]["start"]
                gap_duration = next_start - last_end
                step = gap_duration / (gap_words_count + 1)
                for i in range(gap_words_count):
                    cur_idx = gap_start_idx + i
                    lyrics_words[cur_idx]["start"] = last_end + i * step
                    lyrics_words[cur_idx]["end"] = last_end + (i + 1) * step
                idx = gap_end_idx

        # 5. Verify Interpolated Values for "muy" (index 5)
        # Gap is between "estoy" (end = 4.5) and "bien" (start = 5.5).
        # gap_duration = 5.5 - 4.5 = 1.0. gap_words_count = 1.
        # step = 1.0 / 2 = 0.5.
        # "muy" start = 4.5 + 0 * 0.5 = 4.5
        # "muy" end = 4.5 + 1 * 0.5 = 5.0
        self.assertEqual(lyrics_words[5]["start"], 4.5)
        self.assertEqual(lyrics_words[5]["end"], 5.0)

        # 6. Format results to ms
        aligned_results = []
        for w in lyrics_words:
            start_ms = int(w["start"] * 1000)
            end_ms = int(w["end"] * 1000)
            aligned_results.append({
                "start_ms": start_ms,
                "end_ms": end_ms,
                "word": w["word"],
                "phrase": w["phrase"]
            })

        # Verify formatting
        self.assertEqual(aligned_results[0]["start_ms"], 1000)
        self.assertEqual(aligned_results[5]["start_ms"], 4500)
        self.assertEqual(aligned_results[5]["end_ms"], 5000)
        self.assertEqual(aligned_results[5]["word"], "muy")
        self.assertEqual(aligned_results[5]["phrase"], "Yo estoy muy bien.")
        
        print("Success: Offline alignment and interpolation unit tests passed!")

if __name__ == "__main__":
    unittest.main()
