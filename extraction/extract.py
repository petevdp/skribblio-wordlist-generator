import nltk
nltk.download('all')
from nltk.corpus import stopwords
import json
import sys

def main():
  with open('../phrases.json') as f:
    phrases = json.load(f)
  phrases = [p.lower() for p in phrases]
  words = [*extract_proper_nouns(phrases)]
  json.dumps(words)

def extract_proper_nouns(phrases):
  for text in phrases:
    sentences = nltk.sent_tokenize(text)
    for sentence in sentences:
      words = nltk.word_tokenize(sentence)
      words = [word for word in words if
               word not in set(stopwords.words('english'))]
      tagged = nltk.pos_tag(words)
      for (word, tag) in tagged:
        if tag == 'NNP':  # If the word is a proper noun
          yield word


if __name__ == "__main__":
  main()
