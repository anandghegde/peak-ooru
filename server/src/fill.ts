import { nameProblem } from './names'

/** The measures' weights in thousandths, in the order of docs/API.md (PRD section 6). */
export const WEIGHTS = [250, 200, 150, 100, 100, 100, 100]

const FIRST = [
  'Aarav', 'Aditi', 'Akshay', 'Ananya', 'Anand', 'Anil', 'Anjali', 'Arjun', 'Ashwini', 'Bhavana', 'Chandan', 'Chaitra',
  'Deepa', 'Deepak', 'Divya', 'Ganesh', 'Gowri', 'Harish', 'Harsha', 'Kavya', 'Karthik', 'Keerthi', 'Kiran', 'Lakshmi',
  'Madhu', 'Mahesh', 'Manjunath', 'Meera', 'Mohan', 'Nandini', 'Naveen', 'Nikhil', 'Pavan', 'Pooja', 'Prakash',
  'Priya', 'Rahul', 'Rakesh', 'Ramya', 'Ravi', 'Rekha', 'Rohan', 'Sahana', 'Sandeep', 'Shreya', 'Shruthi', 'Sneha',
  'Srinivas', 'Suma', 'Sunil', 'Suresh', 'Swathi', 'Tejas', 'Usha', 'Varun', 'Vidya', 'Vijay', 'Vinay', 'Yamuna',
  'Farhan', 'Imran', 'Ayesha', 'Zoya', 'Joseph', 'Maria', 'Thomas', 'Neha', 'Rohit', 'Tara', 'Sam', 'Leela', 'Omar',
]
const LAST = [
  'Rao', 'Reddy', 'Gowda', 'Shetty', 'Hegde', 'Kumar', 'Nayak', 'Bhat', 'Iyer', 'Murthy', 'Prasad', 'Sharma', 'Naik',
  'Kamath', 'Pai', 'Menon', 'Nair', 'Joshi', 'Kulkarni', 'Patil', 'Desai', 'Khan', 'Fernandes', "D'Souza", 'Das',
  'Singh', 'Gupta', 'Acharya', 'Raju', 'Swamy',
]
const PLACES = ['Hebbal', 'Jayanagar', 'Whitefield', 'Malleshwaram', 'Indiranagar', 'Yelahanka', 'Banashankari', 'Koramangala', 'Basavanagudi', 'HSR']

/** A name that reads as a name: mostly first and last, sometimes an initial, a place, or a year. */
export function fakeName(random: (n: number) => number): string {
  for (;;) {
    const first = FIRST[random(FIRST.length)]!
    const last = LAST[random(LAST.length)]!.replace("'", '')
    const r = random(10)
    const name =
      r < 5 ? `${first} ${last}` :
      r < 7 ? `${first} ${last[0]}` :
      r < 8 ? `${first} of ${PLACES[random(PLACES.length)]}` :
      r < 9 ? `${first}${1980 + random(30)}` :
      `${first.toLowerCase()} ${last.toLowerCase()}`
    if (!nameProblem(name) && name.length <= 20) return name
  }
}
