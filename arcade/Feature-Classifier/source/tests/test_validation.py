import copy, json, sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from validate import validate, HERE
class ValidationTests(unittest.TestCase):
    def setUp(self): self.c=json.loads((HERE/'default.json').read_text())
    def test_examples(self):
        for f in ['default.json','level2.json']: self.assertEqual(validate(json.loads((HERE/f).read_text())),[])
    def test_bad_class_mapping(self):
        self.c['mechanics']['class_rule']['class_b_value']='round';self.assertTrue(validate(self.c))
    def test_duplicate_features(self):
        self.c['mechanics']['features'][1]['name']='aura';self.assertTrue(validate(self.c))
    def test_wrong_failure_annotation(self):
        self.c['mechanics']['curveballs'][0]['expected_model_failure']=False;self.assertTrue(validate(self.c))
    def test_missing_label(self):
        del self.c['theme']['featureLabels']['aura'];self.assertTrue(validate(self.c))
    def test_missing_test_feature(self):
        del self.c['mechanics']['curveballs'][0]['item']['core'];self.assertTrue(validate(self.c))
if __name__=='__main__': unittest.main()
