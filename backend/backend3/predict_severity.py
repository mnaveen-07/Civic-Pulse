import sys
import json
import re
import numpy as np
import joblib
import pandas as pd
from datetime import datetime

# Try to load the trained model and vectorizer
try:
    model = joblib.load('severity_model.pkl')
    tfidf = joblib.load('tfidf_vectorizer.pkl')
    model_available = True
    # Don't print anything here to avoid JSON parsing issues
except Exception as e:
    model = None
    tfidf = None
    model_available = False

# Critical issue patterns (same as before)
criticalIssuePatterns = {
    "Electricity": [
        re.compile(r'electric.*water|water.*electric|live.*wire.*water|wire.*water', re.IGNORECASE),
        re.compile(r'transformer.*fire|substation.*explosion', re.IGNORECASE),
        re.compile(r'power line.*down|wire.*down.*road', re.IGNORECASE),
        re.compile(r'electric shock|electrocution', re.IGNORECASE)
    ],
    "Roads": [
        re.compile(r'bridge.*collapse|bridge.*damage|overpass.*damage', re.IGNORECASE),
        re.compile(r'road.*collapse|sinkhole|major.*pothole', re.IGNORECASE),
        re.compile(r'landslide|rockslide', re.IGNORECASE),
        re.compile(r'major.*accident|fatal.*accident', re.IGNORECASE)
    ],
    "Water Supply": [
        re.compile(r'water.*contamination|contaminated.*water', re.IGNORECASE),
        re.compile(r'sewage.*leak|sewage.*water', re.IGNORECASE),
        re.compile(r'main.*break|pipe.*burst', re.IGNORECASE),
        re.compile(r'no.*water.*hospital|hospital.*no.*water', re.IGNORECASE)
    ],
    "Public Safety": [
        re.compile(r'active.*shooter|gun.*violence', re.IGNORECASE),
        re.compile(r'fire.*building|building.*fire', re.IGNORECASE),
        re.compile(r'explosion|blast', re.IGNORECASE),
        re.compile(r'violent.*crime|assault|robbery', re.IGNORECASE),
        re.compile(r'chemical.*leak|gas.*leak', re.IGNORECASE)
    ],
    "Sanitation": [
        re.compile(r'hazardous.*waste|toxic.*waste', re.IGNORECASE),
        re.compile(r'chemical.*spill|gas.*leak', re.IGNORECASE),
        re.compile(r'medical.*waste|biohazard', re.IGNORECASE),
        re.compile(r'garbage.*hospital|hospital.*waste', re.IGNORECASE)
    ]
}

crossCategoryCriticalPatterns = [
    re.compile(r'immediate.*danger|life.*threatening', re.IGNORECASE),
    re.compile(r'emergency.*services|ambulance.*needed', re.IGNORECASE),
    re.compile(r'children.*at.*risk|school.*safety', re.IGNORECASE),
    re.compile(r'hospital.*affected|medical.*facility', re.IGNORECASE),
    re.compile(r'evacuation.*needed|evacuate', re.IGNORECASE)
]

def ruleBasedSeverityPrediction(title, description, category):
    text = f"{title} {description}".lower()
    
    # Check category-specific patterns
    if category in criticalIssuePatterns:
        for pattern in criticalIssuePatterns[category]:
            if pattern.search(text):
                return {
                    'severity': 3,
                    'is_critical': True,
                    'reason': f"Critical pattern detected in {category}"
                }
    
    # Check cross-category patterns
    for pattern in crossCategoryCriticalPatterns:
        if pattern.search(text):
            return {
                'severity': 3,
                'is_critical': True,
                'reason': "Critical pattern detected"
            }
    
    return {
        'severity': 1,
        'is_critical': False,
        'reason': "No critical patterns"
    }

def predict_severity(data):
    title = data.get('title', '')
    description = data.get('description', '')
    category = data.get('category', 'Other')
    lat = data.get('lat', 0)
    lng = data.get('lng', 0)
    upvotes = data.get('upvotes', 0)
    
    # First, check for critical patterns
    rule_result = ruleBasedSeverityPrediction(title, description, category)
    if rule_result['is_critical']:
        return rule_result
    
    # If model is available, use it
    if model_available and model is not None and tfidf is not None:
        try:
            # Prepare features
            combined_text = f"{title} {description}"
            
            # Category encoding
            category_mapping = {
                'Roads': 0, 'Electricity': 1, 'Water Supply': 2, 
                'Sanitation': 3, 'Public Safety': 4, 'Other': 5
            }
            category_encoded = category_mapping.get(category, 5)
            
            # Time features
            now = datetime.now()
            hour = now.hour
            day_of_week = now.weekday()
            is_weekend = 1 if day_of_week >= 5 else 0
            
            # Location features (example)
            city_center = (12.8585, 80.1800)
            distance_to_center = np.sqrt((lat - city_center[0])**2 + (lng - city_center[1])**2)
            
            # Text features
            title_length = len(title)
            description_length = len(description)
            
            # Urgency score
            urgency_keywords = ['urgent', 'emergency', 'immediate', 'critical', 'danger', 'life-threatening']
            urgency_score = sum(1 for word in urgency_keywords if word in combined_text.lower())
            
            # Prepare feature vector
            meta_features = np.array([[
                category_encoded, hour, day_of_week, is_weekend,
                distance_to_center, title_length, description_length,
                urgency_score, upvotes
            ]])
            
            text_features = tfidf.transform([combined_text])
            features = np.hstack((text_features.toarray(), meta_features))
            
            # Predict
            severity = int(model.predict(features)[0])
            
            return {
                'severity': severity,
                'is_critical': severity == 3,
                'reason': 'Machine learning prediction'
            }
        except Exception as e:
            # Don't print to stdout, just return fallback
            pass
    
    # Fallback to rule-based
    return rule_result

if __name__ == "__main__":
    # Read input from command line
    try:
        input_data = json.loads(sys.argv[1])
        result = predict_severity(input_data)
        # Only print the JSON result
        print(json.dumps(result))
    except Exception as e:
        # Print a valid JSON even on error
        print(json.dumps({
            'severity': 1,
            'is_critical': False,
            'reason': f'Error: {str(e)}'
        }))